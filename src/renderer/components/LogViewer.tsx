import { useEffect, useRef } from 'react';
import { useServer } from '../hooks/useServer';

// =============================================================================
// LogViewer — 运行日志面板（自动滚底）
// =============================================================================

export default function LogViewer() {
  const { logs, clearLogs } = useServer();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="w-0.5 h-3.5 bg-green-500 rounded-full" />
          <span className="text-xs text-gray-400 select-none">运行日志</span>
          <span className="text-xs text-gray-600 select-none">{logs.length} 行</span>
        </div>
        <button
          onClick={clearLogs}
          className="px-2 py-1 text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-700/60 rounded transition-colors"
        >
          清除
        </button>
      </div>
      <textarea
        ref={textareaRef}
        readOnly
        value={logs.join('\n')}
        className="flex-1 w-full resize-none bg-[#0a0a1a] text-green-400 font-mono text-xs p-3 border-0 outline-none leading-relaxed"
        spellCheck={false}
        placeholder="等待服务器启动..."
      />
    </div>
  );
}
