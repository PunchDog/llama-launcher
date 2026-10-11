import { Section, TextInput, Button } from '../../ui';
import { formatCount } from '../../../utils/format';
import type { ModelInfo } from '@/shared/types';

// =============================================================================
// SearchSection — 模型关键词/组织/ID 搜索与结果列表
// =============================================================================

interface SearchSectionProps {
  keyword: string;
  onKeywordChange: (v: string) => void;
  onSearch: () => void;
  models: ModelInfo[];
  /** 当前选中/输入的模型 ID，用于高亮 */
  selectedId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}

export default function SearchSection({
  keyword,
  onKeywordChange,
  onSearch,
  models,
  selectedId,
  onSelect,
  disabled,
}: SearchSectionProps) {
  return (
    <Section
      title="模型搜索"
      desc="支持关键词（如 qwen3.8 / glm）、组织名（如 Qwen / unsloth）或完整模型 ID（如 unsloth/Qwen3.8-27B-GGUF）；GGUF 文件名自动去扩展名处理"
    >
      <div className="flex gap-2 mb-2">
        <TextInput value={keyword} onChange={onKeywordChange} placeholder="关键词 / 组织名 / 完整模型 ID" onBlur={onSearch} />
        <Button variant="primary" onClick={onSearch} disabled={disabled}>
          获取模型列表
        </Button>
      </div>
      {models.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700/60">
          {models.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={`w-full text-left px-2 py-1.5 transition-colors hover:bg-gray-700/50 ${
                selectedId === m.id ? 'bg-blue-600/15' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-100 font-mono truncate flex-1" title={m.id}>
                  {m.id}
                </span>
                {m.downloads !== undefined && (
                  <span className="text-[10px] text-gray-500 shrink-0">↓ {formatCount(m.downloads)}</span>
                )}
              </div>
              {m.task && <div className="text-[10px] text-blue-400/80">{m.task}</div>}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
