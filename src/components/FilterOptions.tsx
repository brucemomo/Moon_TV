'use client';
import { ArrowUpDown,ChevronDown, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface FilterOptionsProps {
  title: string;
  options: string[];
  selectedOptions: string[];
  onChange: (options: string[]) => void;
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  // 排序相关属性
  sortField?: string;
  onSortFieldChange?: (field: string) => void;
  sortOrder?: 'asc' | 'desc';
  onSortOrderChange?: (order: 'asc' | 'desc') => void;
  sortOptions?: { value: string; label: string }[];
}

export default function FilterOptions({
  title,
  options,
  selectedOptions,
  onChange,
  openFilter,
  setOpenFilter,
  // 排序相关属性
  sortField,
  onSortFieldChange,
  sortOrder,
  onSortOrderChange,
  sortOptions,
}: FilterOptionsProps) {
  // 由父组件控制是否展开
  const open = openFilter === title;

  const [popupStyles, setPopupStyles] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const toggleOpen = () => {
    if (open) {
      setOpenFilter(null); // 已展开 → 关闭
    } else {
      setOpenFilter(title); // 打开自己，关闭其他
    }
  };

  const handleOptionClick = (option: string) => {
    if (selectedOptions.includes(option)) {
      onChange(selectedOptions.filter((o) => o !== option));
    } else {
      onChange([...selectedOptions, option]);
    }
  };

  // 计算弹窗位置，防止超出屏幕
  useEffect(() => {
    if (open && buttonRef.current && popupRef.current) {
      const btnRect = buttonRef.current.getBoundingClientRect();
      const screenWidth = window.innerWidth;

      let left = btnRect.left;
      const top = btnRect.bottom + 4; // 下方间距
      const width = Math.min(screenWidth - 16, 400); // 弹窗最大宽度400，留一点边距

      // 如果右边超出屏幕，向左移动
      if (left + width > screenWidth - 8) {
        left = Math.max(8, screenWidth - width - 8);
      }

      setPopupStyles({ left, top, width });
    }
  }, [open]);

  return (
    <div className="relative inline-block mr-2 mb-2">
      <div className="flex items-center bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden">
        {/* 排序选择器（当提供了排序属性时显示，隐藏原始筛选按钮） */}
        {sortField && onSortFieldChange && sortOrder && onSortOrderChange && sortOptions ? (
          <>
            <div className="relative">
              <button
                onClick={() => setOpenFilter(openFilter === 'sort' ? null : 'sort')}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                {sortOptions.find(opt => opt.value === sortField)?.label || '排序'}
                <ChevronDown className={`w-4 h-4 transition-transform ${openFilter === 'sort' ? 'rotate-180' : 'rotate-0'}`} />
              </button>
              
              {openFilter === 'sort' && (
                <div
                  ref={popupRef}
                  style={popupStyles}
                  className="
                    fixed z-50
                    bg-white dark:bg-gray-800
                    border border-gray-200 dark:border-gray-700
                    rounded-lg shadow-lg p-4
                    max-h-[50vh] overflow-auto
                  "
                >
                  <div className="grid gap-2">
                    {sortOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          onSortFieldChange(option.value);
                          setOpenFilter(null);
                        }}
                        className={`px-3 py-2 text-sm rounded-lg transition-all duration-200 text-left ${
                          sortField === option.value
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <button
              type="button"
              onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors border-l border-gray-300 dark:border-gray-600"
              title={sortOrder === 'asc' ? '升序' : '降序'}
            >
              <ArrowUpDown className={`w-4 h-4 ${sortOrder === 'asc' ? '' : 'rotate-180'}`} />
            </button>
          </>
        ) : (
          /* 原始筛选器按钮（当没有排序属性时显示） */
          <button
            ref={buttonRef}
            onClick={toggleOpen}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {title}
            {selectedOptions.length > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-xs bg-green-500 text-white rounded-full ml-1">
                {selectedOptions.length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : 'rotate-0'}`} />
          </button>
        )}
        
        {selectedOptions.length > 0 && !(sortField && onSortFieldChange && sortOrder && onSortOrderChange && sortOptions) && (
          <button
            onClick={() => onChange([])}
            className="px-2 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            title="清空筛选条件"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={popupRef}
          style={popupStyles}
          className="
            fixed z-50
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg p-4
            max-h-[50vh] overflow-auto
          "
        >
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
            }}
          >
            {options.map((option) => (
              <button
                key={option}
                onClick={() => handleOptionClick(option)}
                className={`px-3 py-2 text-sm rounded-lg transition-all duration-200 text-left ${
                  selectedOptions.includes(option)
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-gray-700/80'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
