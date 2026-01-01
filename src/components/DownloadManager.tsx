'use client';

import { Download, Pause, Play, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { downloadM3U8Video, DownloadProgress, M3U8Task, parseM3U8 } from '@/lib/m3u8-downloader';

import AddDownloadModal from './AddDownloadModal';

interface DownloadTask {
  id: string;
  url: string;
  title: string;
  status: 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';
  progress: number;
  current: number;
  total: number;
  abortController?: AbortController;
  autoResume?: boolean; // 标记是否需要自动恢复下载（刷新页面导致的暂停）
  // 任务配置信息（用于断点续传）
  config?: {
    downloadType: 'TS' | 'MP4';
    concurrency: number;
    rangeMode: boolean;
    startSegment: number;
    endSegment: number;
    parsedTask?: M3U8Task;
  };
}

interface DownloadManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const DownloadManager = ({ isOpen, onClose }: DownloadManagerProps) => {
  // 任务列表状态
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  // 添加下载弹窗状态
  const [showAddModal, setShowAddModal] = useState(false);

  // 从 localStorage 加载任务
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('downloadTasks');
      if (saved) {
        try {
          const savedTasks = JSON.parse(saved);
          setTasks(savedTasks.map((t: DownloadTask) => ({ 
            ...t, 
            // 刷新页面时，将所有正在下载的任务改为暂停状态，并标记需要自动恢复
            status: t.status === 'downloading' ? 'paused' : t.status,
            autoResume: t.status === 'downloading', // 标记是否需要自动恢复
            abortController: undefined 
          })));
        } catch {
          // 忽略解析错误
        }
      }
    }
  }, []);

  // 自动恢复因刷新页面而暂停的下载任务
  useEffect(() => {
    const tasksToResume = tasks.filter(t => t.autoResume && t.status === 'paused');
    if (tasksToResume.length > 0) {
      // 清除 autoResume 标记
      setTasks(prev => prev.map(t => ({ ...t, autoResume: false })));
      
      // 延迟一点时间后开始恢复下载，确保组件已完全加载
      setTimeout(() => {
        tasksToResume.forEach(task => {
          resumeTask(task.id);
        });
      }, 500);
    }
  }, [tasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存任务到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const tasksToSave = tasks.map(({ abortController: _abortController, config, ...rest }) => ({
        ...rest,
        // 保存配置但排除 parsedTask（太大）
        config: config ? {
          downloadType: config.downloadType,
          concurrency: config.concurrency,
          rangeMode: config.rangeMode,
          startSegment: config.startSegment,
          endSegment: config.endSegment,
        } : undefined,
      }));
      localStorage.setItem('downloadTasks', JSON.stringify(tasksToSave));
      
      // 触发自定义事件，通知任务列表更新
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('downloadTasksUpdated'));
      }
    }
  }, [tasks]);

  // 执行下载任务（核心下载逻辑）
  const executeDownload = useCallback(async (
    taskId: string, 
    parsedTask: M3U8Task, 
    controller: AbortController,
    downloadType: 'TS' | 'MP4',
    concurrency: number,
    rangeMode: boolean,
    startSegment: number,
    endSegment: number,
    _useStreamSaver = false
  ) => {
    try {
      const downloadTask = { ...parsedTask };
      downloadTask.type = downloadType;
      
      if (rangeMode) {
        downloadTask.rangeDownload = {
          startSegment: Math.max(1, Math.min(startSegment, parsedTask.tsUrlList.length)),
          endSegment: Math.max(1, Math.min(endSegment, parsedTask.tsUrlList.length)),
          targetSegment: Math.abs(endSegment - startSegment) + 1,
        };
      }

      await downloadM3U8Video(
        downloadTask,
        (prog: DownloadProgress) => {
          setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            
            return { 
              ...t, 
              progress: prog.percentage,
              current: prog.current,
              total: prog.total,
              status: prog.status === 'done' ? 'completed' : 'downloading'
            };
          }));
        },
        controller.signal,
        concurrency
      );
      
      // 确保最终状态为已完成（如果进度回调没有正确设置）
      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        // 只在状态不是 completed 时才更新
        if (t.status === 'completed') return t;
        return { ...t, status: 'completed' as const, progress: 100, abortController: undefined };
      }));
    } catch (error) {
      if (error instanceof Error && error.message === '下载已取消') {
        // eslint-disable-next-line no-console
        console.log('用户取消下载');
        setTasks(prev => prev.map(t => 
          t.id === taskId 
            ? { ...t, status: 'paused' as const, abortController: undefined }
            : t
        ));
      } else {
        // eslint-disable-next-line no-console
        console.error('下载失败:', error);
        setTasks(prev => prev.map(t => 
          t.id === taskId 
            ? { ...t, status: 'error' as const, abortController: undefined }
            : t
        ));
      }
    }
  }, []);

  // 从配置创建并开始下载任务
  const addTaskFromConfig = useCallback((config: {
    url: string;
    title: string;
    downloadType: 'TS' | 'MP4';
    concurrency: number;
    rangeMode: boolean;
    startSegment: number;
    endSegment: number;
    useStreamSaver: boolean;
    parsedTask: M3U8Task;
  }) => {
    const taskId = Date.now().toString();
    const controller = new AbortController();

    // 创建新任务并直接开始下载
    const newTask: DownloadTask = {
      id: taskId,
      url: config.url,
      title: config.title,
      status: 'downloading',
      progress: 0,
      current: 0,
      total: config.parsedTask.tsUrlList.length,
      config: {
        downloadType: config.downloadType,
        concurrency: config.concurrency,
        rangeMode: config.rangeMode,
        startSegment: config.startSegment,
        endSegment: config.endSegment,
        parsedTask: config.parsedTask,
      },
      abortController: controller,
    };

    // 添加到任务列表
    setTasks(prev => [...prev, newTask]);

    // 立即开始下载
    executeDownload(
      taskId,
      config.parsedTask,
      controller,
      config.downloadType,
      config.concurrency,
      config.rangeMode,
      config.startSegment,
      config.endSegment,
      config.useStreamSaver
    );
  }, [executeDownload]);

  // 监听来自播放页面的添加下载任务事件
  useEffect(() => {
    const handleAddTaskEvent = (event: CustomEvent) => {
      const config = event.detail;
      addTaskFromConfig(config);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('addDownloadTask', handleAddTaskEvent as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('addDownloadTask', handleAddTaskEvent as EventListener);
      }
    };
  }, [addTaskFromConfig]);

  // 执行下载任务（从任务配置启动）
  const startTaskDownload = async (taskId: string, parsedTask: M3U8Task) => {
    const taskToDownload = tasks.find(t => t.id === taskId);
    if (!taskToDownload?.config) return;

    const controller = new AbortController();
    const { downloadType, concurrency, rangeMode, startSegment, endSegment } = taskToDownload.config;
    
    // 更新任务状态
    setTasks(prev => prev.map(t => 
      t.id === taskId 
        ? { ...t, status: 'downloading' as const, abortController: controller }
        : t
    ));

    executeDownload(taskId, parsedTask, controller, downloadType, concurrency, rangeMode, startSegment, endSegment);
  };

  // 删除任务
  const deleteTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.abortController) {
      task.abortController.abort();
    }
    setTasks(tasks.filter(t => t.id !== taskId));
  };

  // 暂停任务
  const pauseTask = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.abortController) {
      task.abortController.abort();
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { ...t, status: 'paused' as const, abortController: undefined }
          : t
      ));
    }
  };

  // 继续下载任务
  const resumeTask = async (taskId: string) => {
    const taskToResume = tasks.find(t => t.id === taskId);
    if (!taskToResume || taskToResume.status === 'downloading') return;

    // 如果有保存的解析任务配置，直接使用
    if (taskToResume.config?.parsedTask) {
      startTaskDownload(taskId, taskToResume.config.parsedTask);
      return;
    }

    // 否则重新解析并下载
    try {
      const parsedTask = await parseM3U8(taskToResume.url);
      parsedTask.title = taskToResume.title;
      
      // 保存解析结果到任务配置，保留原有的用户配置
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { 
              ...t, 
              config: {
                downloadType: t.config?.downloadType || 'TS',
                concurrency: t.config?.concurrency || 6,
                rangeMode: t.config?.rangeMode || false,
                startSegment: t.config?.startSegment || 1,
                endSegment: t.config?.endSegment || parsedTask.tsUrlList.length,
                parsedTask,
              }
            }
          : t
      ));

      startTaskDownload(taskId, parsedTask);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('重新解析失败:', error);
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { ...t, status: 'error' as const }
          : t
      ));
    }
  };

  // 全部暂停
  const pauseAllTasks = () => {
    tasks.forEach(task => {
      if (task.status === 'downloading' && task.abortController) {
        task.abortController.abort();
      }
    });
    setTasks(prev => prev.map(t => 
      t.status === 'downloading' 
        ? { ...t, status: 'paused' as const, abortController: undefined }
        : t
    ));
  };

  // 全部开始
  const startAllTasks = () => {
    tasks.forEach(task => {
      if (task.status === 'waiting' || task.status === 'paused' || task.status === 'error') {
        resumeTask(task.id);
      }
    });
  };

  // 清空所有任务
  const clearAllTasks = () => {
    tasks.forEach(task => {
      if (task.abortController) {
        task.abortController.abort();
      }
    });
    setTasks([]);
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Download className="h-5 w-5" />
            下载管理器
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 操作栏 */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            添加下载
          </button>
          <button
            onClick={startAllTasks}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            全部开始
          </button>
          <button
            onClick={pauseAllTasks}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <Pause className="h-4 w-4" />
            全部暂停
          </button>
          <button
            onClick={clearAllTasks}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            清空全部
          </button>
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                暂无下载任务
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-white truncate">
                        {task.title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
                        {task.url}
                      </p>
                      {/* 下载配置信息 */}
                      {task.config && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            {task.config.downloadType} 格式
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                            {task.config.concurrency} 线程
                          </span>
                          {task.config.rangeMode && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
                              范围: {task.config.startSegment}-{task.config.endSegment}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {task.status === 'downloading' ? (
                        <button
                          onClick={() => pauseTask(task.id)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                          title="暂停"
                        >
                          <Pause className="h-4 w-4" />
                        </button>
                      ) : (task.status === 'waiting' || task.status === 'paused' || task.status === 'error') ? (
                        <button
                          onClick={() => resumeTask(task.id)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                          title="开始/继续"
                        >
                          <Play className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 进度条 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">
                        {task.status === 'completed' ? '已完成' : 
                         task.status === 'downloading' ? '下载中' :
                         task.status === 'error' ? '下载失败' :
                         task.status === 'paused' ? '已暂停' : '等待中'}
                      </span>
                      <span className="text-gray-600 dark:text-gray-400">
                        {task.progress.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        {task.current} / {task.total} 片段
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
        </div>
      </div>
    </div>

    {/* 添加下载弹窗 */}
    <AddDownloadModal
      isOpen={showAddModal}
      onClose={() => setShowAddModal(false)}
      onAddTask={(config) => {
        addTaskFromConfig(config);
        setShowAddModal(false);
      }}
      initialUrl=""
      initialTitle=""
    />
    </>
  );
};

export default DownloadManager;
