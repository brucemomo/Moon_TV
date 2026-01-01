'use client';

import { useEffect } from 'react';

/**
 * Service Worker 注册组件
 * 用于支持边下边存功能的流式下载
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 只在支持 Service Worker 且为安全上下文（HTTPS 或 localhost）时注册
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // eslint-disable-next-line no-console
          console.log('Service Worker 注册成功:', reg.scope);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Service Worker 注册失败:', err);
        });
    } else {
      // eslint-disable-next-line no-console
      console.log('当前环境不支持 Service Worker 或不在安全上下文中');
    }
  }, []);

  return null; // 该组件不渲染任何内容
}
