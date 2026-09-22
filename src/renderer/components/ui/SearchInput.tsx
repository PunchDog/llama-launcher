import { useEffect, useRef, useState } from 'react';
import { inputBase } from './styles';

// =============================================================================
// SearchInput — 搜索框（本地即时回显 + 防抖上报 + 回车立即上报）
// =============================================================================

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  /** 回车时额外触发（如立即搜索） */
  onEnter?: (v: string) => void;
  placeholder?: string;
  debounceMs?: number;
  disabled?: boolean;
  className?: string;
}

export default function SearchInput({
  value,
  onChange,
  onEnter,
  placeholder = '搜索…',
  debounceMs = 200,
  disabled = false,
  className = '',
}: SearchInputProps) {
  const [local, setLocal] = useState(value);
  const lastEmitted = useRef(value);
  // 父组件多为内联箭头函数，走 ref 才不会每次渲染都重置防抖计时器
  const emitRef = useRef(onChange);
  emitRef.current = onChange;
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;

  // 外部清空（如切换页面）时同步回来；自己刚上报的值不回灌，避免打断输入
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setLocal(value);
      lastEmitted.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (local === lastEmitted.current) return;
    const timer = setTimeout(() => {
      lastEmitted.current = local;
      emitRef.current(local);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [local, debounceMs]);

  return (
    <input
      type="search"
      value={local}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          lastEmitted.current = local;
          emitRef.current(local);
          enterRef.current?.(local);
        }
      }}
      className={`${inputBase} ${className}`}
      aria-label={placeholder}
    />
  );
}
