/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, RotateCcw, Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { useEffect,useRef, useState } from 'react';

import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getRequestTimeout } from '@/lib/utils';

import FailedSourcesDisplay from '@/components/FailedSourcesDisplay';
import FilterOptions from '@/components/FilterOptions';
import PageLayout from '@/components/PageLayout';
import SearchSuggestions from '@/components/SearchSuggestions';
import SourceSelector from '@/components/SourceSelector';
import VideoCard from '@/components/VideoCard';


function SearchPageClient() {
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [failedSources, setFailedSources] = useState<{ name: string; key: string; error: string }[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // 筛选状态 - 从 URL 参数初始化，如果没有URL参数则从保存的源读取
  const [searchSources, setSearchSources] = useState<string[]>(() => {
    const sources = searchParams.get('sources');
    if (sources) {
      return sources.split(',');
    }
    
    // 如果没有URL参数，检查是否有保存的源
    if (typeof window !== 'undefined') {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          return JSON.parse(savedSources);
        } catch (error) {
          console.error('Failed to parse saved sources:', error);
        }
      }
    }
    
    return [];
  });
  const [selectedTitles, setSelectedTitles] = useState<string[]>(() => {
    const titles = searchParams.get('titles');
    return titles ? titles.split(',') : [];
  });
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    const years = searchParams.get('years');
    return years ? years.split(',') : [];
  });

  // 搜索结果来源筛选状态 - 从 URL 参数初始化
  const [filterSources, setFilterSources] = useState<string[]>(() => {
    const sources = searchParams.get('filter_sources');
    return sources ? sources.split(',') : [];
  });
  // 新增状态：记录当前展开的筛选框
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // 排序状态：字段与顺序（默认：按源数量，倒序）
  const [sortField, setSortField] = useState<'sources' | 'year' | 'episodes'>(() => {
    const sf = searchParams.get('sort');
    return sf === 'sources' || sf === 'episodes' || sf === 'year' ? sf : 'sources';
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const so = searchParams.get('order');
    return so === 'asc' ? 'asc' : 'desc';
  });


  const [viewMode, setViewMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      return userSetting !== null ? userSetting === 'true' : true;
    }
    return true;
  });

  const [streamEnabled, setStreamEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const defaultSaved = localStorage.getItem('defaultStreamSearch');
      return defaultSaved !== null ? defaultSaved === 'true' : true;
    }
    return true;
  });

  // 聚合后的结果
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用标准化的标题（移除多余空格但保留单词间的单个空格）作为聚合键的一部分
      const normalizedTitle = item.title.trim().replace(/\s+/g, ' ');
      const key = `${normalizedTitle}-${item.year || 'unknown'}-${item.episodes.length === 1 ? 'movie' : 'tv'}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aExactMatch = a[1][0].title.toLowerCase().includes(searchQuery.trim().toLowerCase());
      const bExactMatch = b[1][0].title.toLowerCase().includes(searchQuery.trim().toLowerCase());
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      if (aYear === bYear) return a[1][0].title.localeCompare(b[1][0].title);
      if (aYear === 'unknown') return 1;
      if (bYear === 'unknown') return 1;
      return aYear > bYear ? -1 : 1;
    });
  }, [searchResults]);

  // 用于筛选后的聚合结果，保证类型安全
  const filteredAggregatedResults: [string, SearchResult[]][] = useMemo(() => {
    return aggregatedResults
      .filter(([key, group]) => {
        // 来源筛选：如果没有选择任何来源（filterSources.length === 0），默认显示全部；如果选择了来源，只保留包含至少一个选中来源的影片组
        const sourceMatch = filterSources.length === 0 ||
          group.some(item => filterSources.includes(item.source_name));
        // 标题筛选：如果选择了标题，只保留标题匹配的影片组
        const titleMatch = selectedTitles.length === 0 ||
          selectedTitles.includes(group[0].title);
        // 年份筛选：如果选择了年份，只保留年份匹配的影片组
        const yearMatch = selectedYears.length === 0 ||
          selectedYears.includes(group[0].year);
        return sourceMatch && titleMatch && yearMatch;
      })
      .map(([key, group]) => {
        // 在组内也进行筛选，确保组内每个项目都符合筛选条件
        const filteredGroup = group.filter((item) => {
          const titleMatch = selectedTitles.length === 0 || selectedTitles.includes(item.title);
          const yearMatch = selectedYears.length === 0 || selectedYears.includes(item.year);
          return titleMatch && yearMatch;
        });
        return [key, filteredGroup] as [string, SearchResult[]];
      })
      .filter(([_, group]) => group.length > 0);
  }, [aggregatedResults, filterSources, selectedTitles, selectedYears]);

  // 对聚合结果进行排序（支持：源数量、年份、集数；升序/降序）。保留“标题包含关键字”的结果优先。
  const sortedAggregatedResults: [string, SearchResult[]][] = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const isExact = (group: SearchResult[]) => group[0].title.toLowerCase().includes(query);
    const getYearValue = (group: SearchResult[]) => {
      const y = group[0].year;
      if (!y || y === 'unknown') return null;
      const n = Number(y);
      return Number.isNaN(n) ? null : n;
    };
    const getSourcesCount = (group: SearchResult[]) => group.length;
    const getEpisodesCount = (group: SearchResult[]) => {
      let maxEpisodes = 0;
      for (const item of group) {
        const count = Array.isArray(item.episodes) ? item.episodes.length : 0;
        if (count > maxEpisodes) maxEpisodes = count;
      }
      return maxEpisodes;
    };

    const valueOf = (group: SearchResult[]) => {
      switch (sortField) {
        case 'sources':
          return getSourcesCount(group);
        case 'episodes':
          return getEpisodesCount(group);
        case 'year':
        default:
          return getYearValue(group);
      }
    };

    const compare = (a: [string, SearchResult[]], b: [string, SearchResult[]]) => {
      const aVal = valueOf(a[1]);
      const bVal = valueOf(b[1]);

      const aIsNull = aVal === null || aVal === undefined;
      const bIsNull = bVal === null || bVal === undefined;
      if (aIsNull && !bIsNull) return 1;
      if (!aIsNull && bIsNull) return -1;
      if (aIsNull && bIsNull) return 0;

      if ((aVal as number) < (bVal as number)) return sortOrder === 'asc' ? -1 : 1;
      if ((aVal as number) > (bVal as number)) return sortOrder === 'asc' ? 1 : -1;

      return a[1][0].title.localeCompare(b[1][0].title);
    };

    const exact: [string, SearchResult[]][] = [];
    const others: [string, SearchResult[]][] = [];
    for (const item of filteredAggregatedResults) {
      (isExact(item[1]) ? exact : others).push(item);
    }
    exact.sort(compare);
    others.sort(compare);
    return [...exact, ...others];
  }, [filteredAggregatedResults, sortField, sortOrder, searchQuery]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSearchResults = async (query: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setSearchResults([]);
      setFailedSources([]);
      setShowResults(true);

      const params = new URLSearchParams({ q: query.trim() });
      if (!streamEnabled) params.set('stream', '0');
      
      // 添加选中的搜索源到请求参数
      if (searchSources.length > 0) {
        params.set('sources', searchSources.join(','));
      }

      // 添加超时时间参数
      const timeoutSeconds = getRequestTimeout();
      params.set('timeout', timeoutSeconds.toString());

      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!streamEnabled) {
        const json = await response.json();
        setSearchResults(json.aggregatedResults || []);
        setFailedSources(json.failedSources || []);
        setIsLoading(false);
      } else {
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = '';
        let firstResult = true;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const json = JSON.parse(line);
                if (json.pageResults?.length) {
                  setSearchResults((prev) => [...prev, ...json.pageResults]);
                  if (firstResult) {
                    setIsLoading(false);
                    firstResult = false;
                  }
                }
                if (json.failedSources) setFailedSources(json.failedSources);
              } catch {
                //
              }
            }
          }
        }

        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            if (json.pageResults) setSearchResults((prev) => [...prev, ...json.pageResults]);
            if (json.failedSources) setFailedSources(json.failedSources);
          } catch {
            //
          }
        }

        setIsLoading(false);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('搜索失败', err);
      setSearchResults([]);
    }
  };

  // 搜索历史、滚动监听
  useEffect(() => {
    !searchParams.get('q') && document.getElementById('searchInput')?.focus();
    getSearchHistory().then(setSearchHistory);
    const unsubscribe = subscribeToDataUpdates('searchHistoryUpdated', setSearchHistory);
    const handleScroll = () => {
      setShowBackToTop((document.body.scrollTop || 0) > 300);
      setOpenFilter(null);
    };
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      unsubscribe();
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 点击空白处取消高亮
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setSelectedHistoryItem(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // URL 搜索变化
  useEffect(() => {
    const query = searchParams.get('q');
    if (query) {
      setSearchQuery(query);
      
      fetchSearchResults(query);
      setShowSuggestions(false);
      addSearchHistory(query);
    } else {
      setShowResults(false);
      setShowSuggestions(false);
    }
  }, [searchParams]);

  // 更新筛选状态到 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    
    if (searchSources.length > 0) {
      params.set('sources', searchSources.join(','));
    } else {
      params.delete('sources');
    }
    
    if (filterSources.length > 0) {
      params.set('filter_sources', filterSources.join(','));
    } else {
      params.delete('filter_sources');
    }
    
    if (selectedTitles.length > 0) {
      params.set('titles', selectedTitles.join(','));
    } else {
      params.delete('titles');
    }
    
    if (selectedYears.length > 0) {
      params.set('years', selectedYears.join(','));
    } else {
      params.delete('years');
    }

    // 排序字段与顺序
    if (sortField) {
      params.set('sort', sortField);
    } else {
      params.delete('sort');
    }
    if (sortOrder) {
      params.set('order', sortOrder);
    } else {
      params.delete('order');
    }
    
    // 只在有搜索查询时才更新 URL
    if (searchParams.get('q')) {
      window.history.replaceState({}, '', `/search?${params.toString()}`);
    }
  }, [filterSources, selectedTitles, selectedYears, sortField, sortOrder, searchParams]); // 移除 selectedSources 依赖，避免选择搜索源时触发重新搜索

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(!!value.trim());
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) setShowSuggestions(true);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim().replace(/\s+/g, ' ');
    if (!trimmed) return;
    setSearchQuery(trimmed);
    setIsLoading(true);
    setShowResults(true);
    setShowSuggestions(false);
    fetchSearchResults(trimmed);
    addSearchHistory(trimmed);
    // 更新URL包含选中的搜索源和超时时间
    const urlParams = new URLSearchParams();
    urlParams.set('q', trimmed);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超时时间参数
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setIsLoading(true);
    setShowResults(true);
    fetchSearchResults(suggestion);
    addSearchHistory(suggestion);
    // 更新URL包含选中的搜索源和超时时间
    const urlParams = new URLSearchParams();
    urlParams.set('q', suggestion);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超时时间参数
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      document.body.scrollTop = 0;
    }
  };

  // 生成筛选选项
  const sourceOptions = Array.from(new Set(searchResults.map((r) => r.source_name))).sort();
  const titleOptions = Array.from(new Set(searchResults.map((r) => r.title))).sort();
  const yearOptions = Array.from(new Set(searchResults.map((r) => r.year))).sort();

  // 处理排序字段变化的包装函数
  const handleSortFieldChange = (field: string) => {
    setSortField(field as 'sources' | 'year' | 'episodes');
  };

  return (
    <PageLayout activePath="/search">
      <div className="px-4 sm:px-10 py-4 sm:py-8 overflow-visible mb-10">
        {/* 搜索框和搜索源选择器 - 作为一个整体 */}
        <div className="mb-4 max-w-2xl mx-auto">
          <div className="flex items-center">
            {/* 搜索源选择器 - 在搜索框左侧，作为一个整体 */}
            <div className="flex-shrink-0">
              <SourceSelector
                selectedSources={searchSources}
                onChange={setSearchSources}
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
              />
            </div>
            
            {/* 搜索框 */}
            <form onSubmit={handleSearch} className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                id="searchInput"
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder="搜索电影、电视剧..."
                className="w-full h-12 rounded-r-lg rounded-l-none bg-gray-50/80 py-3 pl-10 pr-4 text-base text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400 focus:bg-white border border-gray-200/50 border-l-0 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500 dark:focus:bg-gray-700 dark:border-gray-700 dark:border-l-0"
              />

              <SearchSuggestions query={searchQuery} isVisible={showSuggestions} onSelect={handleSuggestionSelect} onClose={() => setShowSuggestions(false)} />
            </form>
          </div>
        </div>

        {/* 筛选组件弹窗 */}
        {showResults && searchResults.length > 0 && (
          <div className="flex gap-3 flex-wrap mb-4 max-w-[95%] mx-auto">
          <FilterOptions
            title="来源"
            options={sourceOptions}
            selectedOptions={filterSources}
            onChange={setFilterSources}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
          />
          <FilterOptions
            title="标题"
            options={titleOptions}
            selectedOptions={selectedTitles}
            onChange={setSelectedTitles}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
          />
          <FilterOptions
            title="年份"
            options={yearOptions}
            selectedOptions={selectedYears}
            onChange={setSelectedYears}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
          />

          <FilterOptions
            title="排序"
            options={[]}
            selectedOptions={[]}
            onChange={() => {/* no-op for sort filter */}}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            // 排序相关属性
            sortField={sortField}
            onSortFieldChange={handleSortFieldChange}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            sortOptions={[
              { value: 'sources', label: '按源数量' },
              { value: 'year', label: '按年份' },
              { value: 'episodes', label: '按集数' }
            ]}
          />

          
          {/* 全局清空筛选按钮 - 只清空标题、年份和来源筛选，不包含搜索源 */}
          {(filterSources.length > 0 || selectedTitles.length > 0 || selectedYears.length > 0) && (
            <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden mr-2 mb-2">
              <button
                onClick={() => {
                  setFilterSources([]);
                  setSelectedTitles([]);
                  setSelectedYears([]);
                }}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                title="清空所有筛选条件"
              >
                <RotateCcw className="w-4 h-4" />
                清空筛选
              </button>
            </div>
          )}
          </div>
        )}


        {/* 搜索结果 */}
        <div className="max-w-[95%] mx-auto overflow-visible">
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
            </div>
          ) : showResults ? (
          <section className="mb-12">
            <div className="mb-8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">搜索结果</h2>
                <FailedSourcesDisplay failedSources={failedSources} />
              </div>
              <div className="flex items-center gap-4">
                {/* 流式/聚合切换 */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-sm text-gray-700 dark:text-gray-300">流式</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={streamEnabled}
                      onChange={() => setStreamEnabled(!streamEnabled)}
                    />
                    <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600"></div>
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-sm text-gray-700 dark:text-gray-300">聚合</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={viewMode} // true 表示聚合
                      onChange={() => setViewMode(!viewMode)}
                    />
                    <div className="w-9 h-5 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600"></div>
                    <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                  </div>
                </label>
              </div>
            </div>

            <div
              key={`search-results-${viewMode}`}
              className="justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(11rem,_1fr))] sm:gap-x-8"
            >
              {viewMode
                ? sortedAggregatedResults.map(([mapKey, group], index) => (
                    <div key={`agg-${mapKey}-${index}`} className="w-full">
                      <VideoCard
                        from="search"
                        items={group}
                        query={searchQuery.trim() !== group[0].title ? searchQuery.trim() : ''}
                      />
                    </div>
                  ))
                : (() => {
                    const filteredResults = searchResults.filter((item) => {
                      // 来源筛选：如果没有选择任何来源（filterSources.length === 0），默认显示全部；如果选择了来源，只保留包含至少一个选中来源的影片
                      const sourceMatch = filterSources.length === 0 ||
                        filterSources.includes(item.source_name);
                      const titleMatch = selectedTitles.length === 0 || selectedTitles.includes(item.title);
                      const yearMatch = selectedYears.length === 0 || selectedYears.includes(item.year);
                      return sourceMatch && titleMatch && yearMatch;
                    });

                    // 对非聚合结果进行排序
                    return filteredResults
                      .sort((a, b) => {
                        const query = searchQuery.trim().toLowerCase();
                        const aExactMatch = a.title.toLowerCase().includes(query);
                        const bExactMatch = b.title.toLowerCase().includes(query);
                        
                        // 精确匹配的优先
                        if (aExactMatch && !bExactMatch) return -1;
                        if (!aExactMatch && bExactMatch) return 1;

                        let aVal: number | string | null = null;
                        let bVal: number | string | null = null;

                        switch (sortField) {
                          case 'sources':
                            // 在非聚合模式下，源数量总是1，所以按源名称排序
                            aVal = a.source_name;
                            bVal = b.source_name;
                            break;
                          case 'episodes':
                            aVal = a.episodes.length;
                            bVal = b.episodes.length;
                            break;
                          case 'year':
                          default:
                            {
                              const aYear = a.year;
                              const bYear = b.year;
                              if (aYear && aYear !== 'unknown') {
                                const aNum = Number(aYear);
                                aVal = Number.isNaN(aNum) ? aYear : aNum;
                              }
                              if (bYear && bYear !== 'unknown') {
                                const bNum = Number(bYear);
                                bVal = Number.isNaN(bNum) ? bYear : bNum;
                              }
                            }
                            break;
                        }

                        const aIsNull = aVal === null || aVal === undefined;
                        const bIsNull = bVal === null || bVal === undefined;
                        if (aIsNull && !bIsNull) return 1;
                        if (!aIsNull && bIsNull) return -1;
                        if (aIsNull && bIsNull) return 0;

                        if (typeof aVal === 'number' && typeof bVal === 'number') {
                          if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
                          if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
                        } else {
                          // 字符串比较
                          const aStr = String(aVal);
                          const bStr = String(bVal);
                          if (aStr < bStr) return sortOrder === 'asc' ? -1 : 1;
                          if (aStr > bStr) return sortOrder === 'asc' ? 1 : -1;
                        }

                        return a.title.localeCompare(b.title);
                      })
                      .map((item, index) => (
                        <div key={`all-${item.source}-${item.id}-${index}`} className="w-full">
                          <VideoCard
                            id={item.id}
                            title={item.title}
                            poster={item.poster}
                            episodes={item.episodes.length}
                            source={item.source}
                            source_name={item.source_name}
                            douban_id={item.douban_id}
                            query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
                            year={item.year}
                            from="search"
                            type={item.episodes.length > 1 ? 'tv' : 'movie'}
                          />
                        </div>
                      ));
                  })()}
              {searchResults.length === 0 && (
                <div className="col-span-full text-center text-gray-500 py-8 dark:text-gray-400">未找到相关结果</div>
              )}
            </div>
          </section>

          ) : searchHistory.length > 0 ? (
            <section className="mb-12">
            <h2 className="mb-4 text-xl font-bold text-gray-800 text-left dark:text-gray-200">
              搜索历史
              {searchHistory.length > 0 && (
                <button
                  onClick={() => clearSearchHistory()}
                  className="ml-3 text-sm text-gray-500 hover:text-red-500 transition-colors dark:text-gray-400 dark:hover:text-red-500"
                >
                  清空
                </button>
              )}
            </h2>
            <div ref={historyRef} className="flex flex-wrap gap-2">
  {searchHistory.map((item, index) => (
    <div key={`history-${item}-${index}`} className="relative group">
      <button
        onClick={() => {
          if (selectedHistoryItem === item) {
            // 第二次点击触发搜索
            const urlParams = new URLSearchParams();
            urlParams.set('q', item.trim());
            const timeoutSeconds = getRequestTimeout();
            urlParams.set('timeout', timeoutSeconds.toString());
            router.push(`/search?${urlParams.toString()}`);
          } else {
            // 第一次点击，选中历史项
            setSearchQuery(item);
            setSelectedHistoryItem(item);
          }
        }}
        className={`px-4 py-2 rounded-full text-sm transition-colors duration-200 ${
          selectedHistoryItem === item
            ? 'bg-green-500/20 text-green-600 dark:bg-green-600/30 dark:text-green-300'
            : 'bg-gray-500/10 hover:bg-gray-300 text-gray-700 dark:bg-gray-700/50 dark:hover:bg-gray-600 dark:text-gray-300'
        }`}
      >
        {item}
      </button>

      {/* 删除按钮 */}
      {(selectedHistoryItem === item) ? (
        <button
          aria-label="删除搜索历史"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            deleteSearchHistory(item);
            if (selectedHistoryItem === item) setSelectedHistoryItem(null);
          }}
          className="absolute -top-1 -right-1 w-4 h-4 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      ) : (
        <button
          aria-label="删除搜索历史"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            deleteSearchHistory(item);
          }}
          className="absolute -top-1 -right-1 w-4 h-4 opacity-0 group-hover:opacity-100 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center text-[10px] transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  ))}
</div>

          </section>
          ) : null}
        </div>
      </div>

      <button
        onClick={scrollToTop}
        className={`fixed bottom-20 md:bottom-6 right-6 z-[500] w-12 h-12 bg-green-500/90 hover:bg-green-500 text-white rounded-full shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out flex items-center justify-center group ${
          showBackToTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
        aria-label="返回顶部"
      >
        <ChevronUp className="w-6 h-6 transition-transform group-hover:scale-110" />
      </button>
    </PageLayout>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
