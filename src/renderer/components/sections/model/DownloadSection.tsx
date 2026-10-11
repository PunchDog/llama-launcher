import { Section, TextInput, Button, ProgressBar } from '../../ui';
import { formatSpeed, formatSizeDash } from '../../../utils/format';
import type { ModelDownloadState, ModelScopeEnvState } from '@/shared/types';

// =============================================================================
// DownloadSection — 目标输入 / HTTPS+CLI 双入口 / 进度 / HTTPS 失败回退卡片
// =============================================================================

interface DownloadSectionProps {
  state: ModelDownloadState;
  env: ModelScopeEnvState | null;
  target: string;
  onTargetChange: (v: string) => void;
  canStart: boolean;
  installing: boolean;
  storeError: string | null;
  onDownloadHttp: () => void;
  onUseCli: () => void;
  onCancel: () => void;
}

export default function DownloadSection({
  state,
  env,
  target,
  onTargetChange,
  canStart,
  installing,
  storeError,
  onDownloadHttp,
  onUseCli,
  onCancel,
}: DownloadSectionProps) {
  const isDownloading = state.isDownloading;

  return (
    <Section title="下载" desc="优先 HTTPS 直链；下载开始会生成清单文件记录本次内容，完成或取消时自动清理">
      <div className="space-y-2">
        <TextInput value={target} onChange={onTargetChange} mono placeholder="模型名，如 Qwen/Qwen2.5-7B-Instruct" disabled={isDownloading} />
        <div className="flex gap-2">
          <Button variant="primary" onClick={onDownloadHttp} disabled={isDownloading || !canStart} className="flex-1">
            {state.mode === 'http' ? '下载中...' : '下载（HTTPS）'}
          </Button>
          {env?.modelscopeInstalled && (
            <Button
              variant="secondary"
              onClick={onUseCli}
              disabled={isDownloading || !canStart}
              title="使用 ModelScope Python 工具下载"
            >
              {state.mode === 'cli' ? '下载中...' : 'Python 工具下载'}
            </Button>
          )}
          {isDownloading && (
            <Button variant="danger" onClick={onCancel} title="停止下载并清理本次已下载的文件">
              取消
            </Button>
          )}
        </div>

        {(isDownloading || state.error || state.httpFailed || state.progress > 0) && (
          <div className="pt-1">
            <ProgressBar progress={state.progress} className="overflow-hidden" />
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-gray-400 truncate flex-1" title={state.currentFile}>
                {state.currentFile || state.status}
              </span>
              <span className="text-xs text-blue-400 font-mono shrink-0 ml-2">
                {formatSpeed(state.downloadSpeed)}
              </span>
            </div>
            <div className="flex justify-between items-center mt-0.5">
              <span className="text-xs text-gray-400">
                {state.downloadSize > 0
                  ? `${formatSizeDash(state.downloadedBytes)} / ${formatSizeDash(state.downloadSize)}`
                  : ''}
              </span>
              <span className="text-xs text-blue-400 font-mono">
                {state.progress.toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        {state.httpFailed && (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2">
            <p className="text-xs text-red-300">HTTPS 直链下载失败，可改用 ModelScope Python 工具继续下载。</p>
            {env?.modelscopeInstalled ? (
              <p className="text-[11px] text-gray-400 mt-1">已安装 ModelScope，点击上方「Python 工具下载」继续。</p>
            ) : (
              <Button variant="secondary" onClick={onUseCli} disabled={installing} className="mt-2 w-full">
                {installing ? '准备中...' : '安装并使用 Python 工具'}
              </Button>
            )}
          </div>
        )}

        {storeError && !state.httpFailed && <p className="text-xs text-red-400">{storeError}</p>}
      </div>
    </Section>
  );
}
