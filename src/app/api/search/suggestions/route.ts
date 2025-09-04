/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getCacheTime, getConfig } from '@/lib/config';
import { searchFromApiStream } from '@/lib/downstream'; // 改用流式方法

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (config.UserConfig.Users) {
      // 检查用户是否被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (user && user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const timeoutParam = searchParams.get('timeout');
    const timeout = timeoutParam ? parseInt(timeoutParam, 10) * 1000 : undefined; // 转换为毫秒

    if (!query) {
      return NextResponse.json({ suggestions: [] });
    }

    const cacheTime = await getCacheTime();

    // 用 ReadableStream 流式返回搜索建议
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const suggestionsStream = generateSuggestionsStream(query, timeout);

        for await (const suggestions of suggestionsStream) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ suggestions }) + '\n')
          );
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `private, max-age=${cacheTime}`,
      },
    });
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function* generateSuggestionsStream(query: string, timeout?: number) {
  const queryLower = query.toLowerCase();
  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site: any) => !site.disabled);

  if (apiSites.length > 0) {
    // 取第一个可用的数据源进行流式搜索
    const firstSite = apiSites[0];

    for await (const results of searchFromApiStream(firstSite, query, true, timeout)) {
      const realKeywords: string[] = Array.from(
        new Set(
          results
            .map((r: any) => r.title)
            .filter(Boolean)
            .flatMap((title: string) => title.split(/[ -:：·、-]/))
            .filter(
              (w: string) =>
                w.length > 1 && w.toLowerCase().includes(queryLower)
            )
        )
      ).slice(0, 8);

      const realSuggestions = realKeywords.map((word) => {
        const wordLower = word.toLowerCase();
        const queryWords = queryLower.split(/[ -:：·、-]/);

        let score = 1.0;
        if (wordLower === queryLower) {
          score = 2.0; // 完全匹配
        } else if (
          wordLower.startsWith(queryLower) ||
          wordLower.endsWith(queryLower)
        ) {
          score = 1.8;
        } else if (queryWords.some((qw) => wordLower.includes(qw))) {
          score = 1.5;
        }

        let type: 'exact' | 'related' | 'suggestion' = 'related';
        if (score >= 2.0) {
          type = 'exact';
        } else if (score >= 1.5) {
          type = 'related';
        } else {
          type = 'suggestion';
        }

        return { text: word, type, score };
      });

      const sortedSuggestions = realSuggestions.sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        const typePriority = { exact: 3, related: 2, suggestion: 1 };
        return typePriority[b.type] - typePriority[a.type];
      });

      // 每次 yield 一批建议
      yield sortedSuggestions;
    }
  }
}
