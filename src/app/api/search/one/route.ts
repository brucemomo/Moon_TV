import { getConfig } from '@/lib/config';
import { searchFromApiStream } from '@/lib/downstream'; // 要用流式版本
import { yellowWords } from '@/lib/yellow';

export const runtime = 'edge';

// OrionTV 兼容接口（SSE 流式）
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');
  const timeoutParam = searchParams.get('timeout');
  const timeout = timeoutParam ? parseInt(timeoutParam, 10) * 1000 : undefined; // 转换为毫秒

  if (!query || !resourceId) {
    return new Response('缺少必要参数: q 或 resourceId', { status: 400 });
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);
  const targetSite = apiSites.find((site) => site.key === resourceId);

  if (!targetSite) {
    return new Response(`未找到指定的视频源: ${resourceId}`, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const batch of searchFromApiStream(targetSite, query, true, timeout)) {
          // 过滤黄词
          let result = batch;
          if (!config.SiteConfig.DisableYellowFilter) {
            result = result.filter((item) => {
              const typeName = item.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          if (result.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
