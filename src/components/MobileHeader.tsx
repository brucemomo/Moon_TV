'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useState } from 'react';

import { BackButton } from './BackButton';
import DownloadManager from './DownloadManager';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  
  // 下载管理器状态
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [downloadTaskCount, setDownloadTaskCount] = useState(0);

  // 监听下载任务变化，更新角标
  useEffect(() => {
    const updateTaskCount = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('downloadTasks');
        if (saved) {
          try {
            const tasks = JSON.parse(saved);
            // 统计未完成的任务数量（下载中、暂停、等待、错误）
            const activeCount = tasks.filter(
              (t: { status: string }) => 
                t.status === 'downloading' || 
                t.status === 'paused' || 
                t.status === 'waiting' || 
                t.status === 'error'
            ).length;
            setDownloadTaskCount(activeCount);
          } catch {
            setDownloadTaskCount(0);
          }
        } else {
          setDownloadTaskCount(0);
        }
      }
    };

    // 初始加载
    updateTaskCount();

    // 监听 localStorage 变化
    const handleStorageChange = () => {
      updateTaskCount();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      // 自定义事件：当任务列表更新时
      window.addEventListener('downloadTasksUpdated', handleStorageChange as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener('downloadTasksUpdated', handleStorageChange as EventListener);
      }
    };
  }, []);

  return (
    <>
    <header className='md:hidden relative w-full bg-white/70 backdrop-blur-xl border-b border-gray-200/50 shadow-sm dark:bg-gray-900/70 dark:border-gray-700/50'>
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左侧：返回按钮 */}
        <div className='flex items-center gap-2'>
          {showBackButton && <BackButton />}
        </div>

        {/* 右侧按钮 */}
        <div className='flex items-center gap-2'>
          <button
            onClick={() => setShowDownloadManager(true)}
            className='p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors relative'
            title='下载管理器'
          >
            <Download className='h-5 w-5' />
            {downloadTaskCount > 0 && (
              <span className='absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 w-4 flex items-center justify-center'>
                {downloadTaskCount > 9 ? '9+' : downloadTaskCount}
              </span>
            )}
          </button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {/* 中间：Logo（绝对居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          className='text-2xl font-bold text-green-600 tracking-tight hover:opacity-80 transition-opacity'
        >
          {siteName}
        </Link>
      </div>
    </header>

    {/* 下载管理器 - 在 header 外部渲染，避免堆叠上下文问题 */}
    <DownloadManager
      isOpen={showDownloadManager}
      onClose={() => setShowDownloadManager(false)}
    />
    </>
  );
};

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
export default memo(MobileHeader);
