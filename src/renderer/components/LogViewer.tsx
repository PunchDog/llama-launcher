import { useEffect, useMemo, useRef } from 'react';
import { logLines, useLogsStore } from '../stores/logsStore';

// =============================================================================
// LogViewer — 运行日志面板（自动滚底）
//   只订阅 logsStore 的 seq：日志在主进程侧按 50ms 合批推送，一次合批渲染一次，
//   不再像旧的 useServer 那样每个订阅者各自持有一份 5000 行副本。
// =============================================================================

export default function LogViewer() {
  const seq = useLogsStore((s) => s.seq);
  const clear = useLogsStore((s) => s.clear);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // seq 是环形缓冲的版本号，故意只依赖它：无关重渲染直接复用上次拼接结果
  const { text, count } = useMemo(
    () => {
      const lines = logLines();
      return { text: lines.join('\n'), count: lines.length };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seq],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-0.5 h-3.5 bg-green-500 rounded-full" />
          <span className="text-xs text-gray-400 select-none">运行日志</span>
          <span className="text-xs text-gray-600 select-none">{count} 行</span>
        </div>
        <button
          onClick={clear}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-700/60 rounded transition-colors"
        >
          清除
        </button>
      </div>
      <textarea
        ref={textareaRef}
        readOnly
        value={text}
        className="flex-1 w-full resize-none bg-[#0a0a1a] text-green-400 font-mono text-xs p-3 border-0 outline-none leading-relaxed"
        spellCheck={false}
        placeholder="等待服务器启动..."
      />
    </div>
  );
}
