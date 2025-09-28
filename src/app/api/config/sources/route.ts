import { NextRequest } from 'next/server';

import { getCacheTime,getConfig } from '@/lib/config';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const config = await getConfig();
    const sources = config.SourceConfig || [];
    
    const cacheTime = await getCacheTime();
    
    return new Response(JSON.stringify(sources), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=0`, // 使用配置的缓存时间
      },
    });
  } catch (error) {
    console.error('Failed to get sources:', error);
    return new Response(JSON.stringify([]), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}