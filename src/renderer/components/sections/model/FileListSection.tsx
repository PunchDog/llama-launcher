import { Section, Button } from '../../ui';
import { formatSizeDash } from '../../../utils/format';
import type { ModelFile } from '@/shared/types';

// =============================================================================
// FileListSection — 已浏览模型的文件清单（勾选要下载的文件）
// =============================================================================

interface FileListSectionProps {
  /** 当前展开文件列表的模型 id；空 = 尚未浏览 */
  browsed: string;
  files: ModelFile[];
  selectedFiles: string[];
  onToggle: (path: string) => void;
  onRefresh: () => void;
  disabled: boolean;
}

export default function FileListSection({
  browsed,
  files,
  selectedFiles,
  onToggle,
  onRefresh,
  disabled,
}: FileListSectionProps) {
  return (
    <Section
      title="文件列表"
      desc={browsed ? `模型 ${browsed} 的文件，勾选需下载的文件` : '请先在上一步选择模型'}
      actions={
        browsed ? (
          <Button variant="ghost" onClick={onRefresh} disabled={disabled}>
            刷新
          </Button>
        ) : undefined
      }
    >
      {browsed ? (
        files.length > 0 ? (
          <div className="max-h-60 overflow-y-auto rounded border border-gray-700">
            {files.map((f) => {
              const checked = selectedFiles.includes(f.path);
              return (
                <label
                  key={f.path}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-gray-700/40 ${
                    checked ? 'bg-blue-600/10' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(f.path)}
                    disabled={disabled}
                    className="accent-blue-500 w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs text-gray-200 font-mono flex-1 min-w-0 truncate" title={f.path}>
                    {f.name}
                  </span>
                  <span className="text-[10px] text-gray-500 shrink-0">{formatSizeDash(f.size)}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-500">暂无文件，点击右上角「刷新」获取。</p>
        )
      ) : (
        <p className="text-xs text-gray-500">尚未选择模型。</p>
      )}
    </Section>
  );
}
