'use client';

import { Download, Loader2, Pause, Play, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { downloadM3U8Video, DownloadProgress, M3U8Task, parseM3U8 } from '@/lib/m3u8-downloader';

interface DownloadTask {
  id: string;
  url: string;
  title: string;
  status: 'waiting' | 'downloading' | 'paused' | 'completed' | 'error';
  progress: number;
  current: number;
  total: number;
  abortController?: AbortController;
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
  initialUrl?: string;
  initialTitle?: string;
}

/**
 * 格式化秒数为时长字符串 (HH:MM:SS 或 MM:SS)
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

const DownloadManager = ({ isOpen, onClose, initialUrl = '', initialTitle = '' }: DownloadManagerProps) => {
  // 任务列表状态
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  
  // 添加任务弹窗状态
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [task, setTask] = useState<M3U8Task | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadType, setDownloadType] = useState<'TS' | 'MP4'>('TS');
  const [rangeMode, setRangeMode] = useState(false);
  const [startSegment, setStartSegment] = useState(1);
  const [endSegment, setEndSegment] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [concurrency, setConcurrency] = useState(6); // 线程数，默认6
  const [useStreamSaver, setUseStreamSaver] = useState(false); // 是否使用边下边存
  
  // 本地可编辑状态
  const [editableUrl, setEditableUrl] = useState('');
  const [editableTitle, setEditableTitle] = useState('');

  // 从 localStorage 加载任务
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('downloadTasks');
      if (saved) {
        try {
          const savedTasks = JSON.parse(saved);
          setTasks(savedTasks.map((t: DownloadTask) => ({ ...t, abortController: undefined })));
        } catch {
          // 忽略解析错误
        }
      }
    }
  }, []);

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
    }
  }, [tasks]);

  // 打开添加任务窗口（手动点击"添加下载"按钮时调用）
  const handleOpenAddModal = () => {
    setShowAddModal(true);
    // 如果有初始URL和标题（从播放器传递的），则使用它们，否则为空
    setEditableUrl(initialUrl || '');
    setEditableTitle(initialTitle || '');
    setTask(null);
    setProgress(null);
    // 保留用户上次的配置（downloadType, concurrency, useStreamSaver）
  };

  // 监听下载管理器关闭，重置所有状态
  useEffect(() => {
    if (!isOpen) {
      setShowAddModal(false);
      setEditableUrl('');
      setEditableTitle('');
      setTask(null);
      setProgress(null);
      // 保留用户配置：downloadType, rangeMode, concurrency, useStreamSaver
      setStartSegment(1);
      setEndSegment(1);
    }
  }, [isOpen]);

  // 当添加窗口打开且有URL时，自动执行解析
  useEffect(() => {
    if (showAddModal && editableUrl && !task && !isLoading) {
      handleParse();
    }
  }, [showAddModal, editableUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // 解析 M3U8
  const handleParse = async () => {
    if (!editableUrl) {
      return;
    }

    setIsLoading(true);
    try {
      const parsedTask = await parseM3U8(editableUrl);
      // 使用可编辑的标题，如果为空则使用解析出的标题
      parsedTask.title = editableTitle || parsedTask.title;
      parsedTask.type = downloadType;
      setTask(parsedTask);
      setEndSegment(parsedTask.tsUrlList.length);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('解析失败:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 开始下载
  const handleDownload = async () => {
    if (!task) return;

    const taskId = Date.now().toString();
    const controller = new AbortController();

    // 创建新任务并直接开始下载
    const newTask: DownloadTask = {
      id: taskId,
      url: editableUrl,
      title: task.title,
      status: 'downloading',
      progress: 0,
      current: 0,
      total: task.tsUrlList.length,
      config: {
        downloadType,
        concurrency,
        rangeMode,
        startSegment,
        endSegment,
        parsedTask: task,
      },
      abortController: controller,
    };

    // 添加到任务列表
    setTasks(prev => [...prev, newTask]);
    
    // 关闭添加窗口
    setShowAddModal(false);
    setTask(null);
    setProgress(null);

    // 立即开始下载
    executeDownload(taskId, task, controller, downloadType, concurrency, rangeMode, startSegment, endSegment);
  };

  // 执行下载任务（核心下载逻辑）
  const executeDownload = async (
    taskId: string, 
    parsedTask: M3U8Task, 
    controller: AbortController,
    downloadType: 'TS' | 'MP4',
    concurrency: number,
    rangeMode: boolean,
    startSegment: number,
    endSegment: number
  ) => {
    // 获取当前任务的进度，用于继续下载时避免进度回退
    const currentTask = tasks.find(t => t.id === taskId);
    const previousProgress = currentTask?.progress || 0;

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
      
      // 下载完成
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { ...t, status: 'completed' as const, progress: 100, abortController: undefined }
          : t
      ));
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
  };

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
      
      // 保存解析结果到任务配置
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { 
              ...t, 
              config: {
                downloadType: 'TS',
                concurrency: 6,
                rangeMode: false,
                startSegment: 1,
                endSegment: parsedTask.tsUrlList.length,
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

  /**
   * 计算范围下载的时间段（起始时间和结束时间）
   */
  const calculateRangeTimeSegment = (): { startTime: number; endTime: number; duration: number } => {
    if (!task || !rangeMode) return { startTime: 0, endTime: 0, duration: 0 };
    
    const totalSegments = task.tsUrlList.length;
    const totalDuration = task.durationSecond;
    
    if (totalSegments === 0 || totalDuration === 0) return { startTime: 0, endTime: 0, duration: 0 };
    
    // 计算每个片段的平均时长
    const avgDurationPerSegment = totalDuration / totalSegments;
    
    // 验证和校正范围
    const validStart = Math.max(1, Math.min(startSegment, totalSegments));
    const validEnd = Math.max(1, Math.min(endSegment, totalSegments));
    const actualStart = Math.min(validStart, validEnd);
    const actualEnd = Math.max(validStart, validEnd);
    
    // 计算起始时间（片段索引从1开始，所以要减1）
    const startTime = (actualStart - 1) * avgDurationPerSegment;
    // 计算结束时间
    const endTime = actualEnd * avgDurationPerSegment;
    // 计算时长
    const duration = endTime - startTime;
    
    return { startTime, endTime, duration };
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 下载管理器主窗口 */}
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
              onClick={handleOpenAddModal}
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
                暂无下载任务，点击"添加下载"开始
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
                      {task.config?.concurrency && (
                        <span className="text-blue-600 dark:text-blue-400">
                          {task.config.concurrency} 线程
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 添加下载任务弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[10000] flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            {/* 关闭按钮 */}
            <button
              onClick={() => {
                setShowAddModal(false);
                setEditableUrl('');
                setEditableTitle('');
                setTask(null);
                setProgress(null);
              }}
              className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="h-6 w-6" />
            </button>

            {/* 标题 */}
            <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">下载 M3U8 视频</h2>

            {/* 内容 */}
            <div className="space-y-4">
          {/* M3U8 URL */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              M3U8 地址
            </label>
            <input
              type="text"
              value={editableUrl}
              onChange={(e) => setEditableUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="请输入 M3U8 链接地址"
            />
          </div>

          {/* 视频标题 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              保存标题
            </label>
            <input
              type="text"
              value={task ? task.title : editableTitle}
              onChange={(e) => {
                const newTitle = e.target.value;
                setEditableTitle(newTitle);
                if (task) {
                  setTask({ ...task, title: newTitle });
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              placeholder="请输入文件名"
            />
          </div>

          {/* 保存格式 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              保存格式
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="TS"
                  checked={downloadType === 'TS'}
                  onChange={(e) => setDownloadType(e.target.value as 'TS' | 'MP4')}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">TS 格式</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="MP4"
                  checked={downloadType === 'MP4'}
                  onChange={(e) => setDownloadType(e.target.value as 'TS' | 'MP4')}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">MP4 格式</span>
              </label>
            </div>
          </div>

          {/* 边下边存 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              边下边存
              <span className="ml-2 text-xs text-gray-500">（开启后可解决大文件下载内存不足的问题）</span>
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="false"
                  checked={!useStreamSaver}
                  onChange={() => setUseStreamSaver(false)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">否</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="true"
                  checked={useStreamSaver}
                  onChange={() => setUseStreamSaver(true)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">是</span>
              </label>
            </div>
          </div>

          {/* 线程数设置 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              下载线程数
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1}
                max={16}
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value))}
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Math.max(1, Math.min(16, parseInt(e.target.value) || 6)))}
                  className="w-16 rounded border border-gray-300 px-2 py-1 text-center dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">线程</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              推荐设置 4-8 个线程，过多可能被服务器限速
            </p>
          </div>

          {/* 范围下载 */}
          {task && (
            <div>
              <label className="mb-2 flex items-center">
                <input
                  type="checkbox"
                  checked={rangeMode}
                  onChange={(e) => setRangeMode(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  范围下载 (总共 {task.tsUrlList.length} 个片段)
                </span>
              </label>
              {rangeMode && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                        起始片段
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={task.tsUrlList.length}
                        value={startSegment}
                        onChange={(e) => setStartSegment(parseInt(e.target.value) || 1)}
                        className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">
                        结束片段
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={task.tsUrlList.length}
                        value={endSegment}
                        onChange={(e) => setEndSegment(parseInt(e.target.value) || task.tsUrlList.length)}
                        className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  </div>
                  {/* 显示范围时间段 */}
                  <div className="rounded-md bg-green-50 px-3 py-2 dark:bg-green-900/20">
                    <p className="text-sm text-green-700 dark:text-green-400">
                      <span className="font-medium">时间段:</span>{' '}
                      {formatDuration(calculateRangeTimeSegment().startTime)}
                      {' '}-{' '}
                      {formatDuration(calculateRangeTimeSegment().endTime)}
                      {' '}(时长 {formatDuration(calculateRangeTimeSegment().duration)})
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 视频信息 */}
          {task && (
            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">片段数量:</span> {task.tsUrlList.length}
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">视频时长:</span> {Math.round(task.durationSecond)} 秒
              </p>
              {task.aesConf.key && (
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  ⚠️ 检测到 AES 加密，将自动解密
                </p>
              )}
            </div>
          )}

          {/* 下载进度 */}
          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">{progress.message}</span>
                <span className="font-medium text-gray-900 dark:text-white">{progress.percentage}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {progress.current} / {progress.total} 个片段
              </p>
            </div>
          )}

          {/* 按钮组 */}
          <div className="mt-6 flex justify-end gap-3">
            {isLoading && abortController && (
              <button
                onClick={() => {
                  if (abortController) {
                    abortController.abort();
                    setAbortController(null);
                    setIsLoading(false);
                    setProgress(null);
                  }
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                取消下载
              </button>
            )}
            
            <button
              onClick={handleParse}
              disabled={isLoading || !editableUrl}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              解析 M3U8
            </button>

            {task && !progress && (
              <button
                onClick={handleDownload}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                <Download className="h-4 w-4" />
                开始下载
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )}
    </>
  );
};

export default DownloadManager;
