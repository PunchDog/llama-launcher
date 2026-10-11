// =============================================================================
// ProgressBar — 下载进度条（Core 更新与模型下载共用样式）
// =============================================================================

interface ProgressBarProps {
  /** 0-100，超出自动截断 */
  progress: number;
  /** 附加到外槽的类名（如 overflow-hidden） */
  className?: string;
}

export default function ProgressBar({ progress, className }: ProgressBarProps) {
  return (
    <div className={`w-full bg-gray-700 rounded-full h-2 ${className ?? ''}`}>
      <div
        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(progress, 100)}%` }}
      />
    </div>
  );
}
