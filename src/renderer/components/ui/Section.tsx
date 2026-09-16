import { useState, useId } from 'react';
import { cardBase, cardHeader, cardTitle } from './styles';

// =============================================================================
// Section — 卡片分区（可折叠），四个配置页统一样式
// =============================================================================

interface SectionProps {
  title: string;
  /** 标题下方灰色小字说明 */
  desc?: string;
  /** 标题右侧操作区（按钮等） */
  actions?: React.ReactNode;
  /** 是否可折叠，默认 true */
  collapsible?: boolean;
  /** 初始是否展开，默认 true */
  defaultOpen?: boolean;
  /** 内容区是否禁用（如 RPC 未启用） */
  disabled?: boolean;
  children: React.ReactNode;
}

export default function Section({
  title,
  desc,
  actions,
  collapsible = true,
  defaultOpen = true,
  disabled = false,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className={cardBase}>
      <div className={cardHeader}>
        <button
          type="button"
          onClick={() => collapsible && setOpen((v) => !v)}
          className={`flex items-center gap-2 flex-1 min-w-0 text-left transition-opacity ${
            collapsible ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
          }`}
          aria-expanded={collapsible ? open : undefined}
          aria-controls={collapsible ? contentId : undefined}
        >
          <span className="w-0.5 h-3.5 bg-blue-500 rounded-full shrink-0" />
          <span className={`${cardTitle} truncate`}>{title}</span>
          {collapsible && (
            <span
              className={`ml-auto text-gray-500 text-xs transition-transform duration-200 ${
                open ? 'rotate-90' : 'rotate-0'
              }`}
            >
              ▶
            </span>
          )}
        </button>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>

      {open && (
        <div id={contentId} className={`px-3 pb-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {desc && <p className="text-xs text-gray-500 mb-2">{desc}</p>}
          {children}
        </div>
      )}
    </div>
  );
}
