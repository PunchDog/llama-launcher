import type { ReactNode } from 'react';
import type { AnyParamDef } from '@/shared/params/schema';
import { hintBase, labelBase } from '../ui';

// =============================================================================
// TriStateControl — 三态参数的外框：标签 + 跟随默认/已显式切换 + 恢复默认 + 偏离高亮
//   有候选值的下拉型控件把「跟随默认」做进下拉首项，此时 showToggle=false，
//   否则右上角这个小按钮是用户把参数改回「不发射」的唯一入口。
// =============================================================================

const SPAN_CLASS: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
};

interface TriStateControlProps {
  def: AnyParamDef;
  inherit: boolean;
  deviated: boolean;
  tooltip: string;
  span: number;
  showToggle: boolean;
  disabled?: boolean;
  showDesc?: boolean;
  onToggleInherit: () => void;
  onReset: () => void;
  children: ReactNode;
}

export default function TriStateControl({
  def,
  inherit,
  deviated,
  tooltip,
  span,
  showToggle,
  disabled = false,
  showDesc = false,
  onToggleInherit,
  onReset,
  children,
}: TriStateControlProps) {
  return (
    <div className={`${SPAN_CLASS[span]} relative ${deviated ? 'pl-1.5' : ''}`}>
      {deviated && (
        <span
          className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-blue-500/70"
          title="该参数偏离启动器默认值"
        />
      )}
      <div className="flex items-center gap-2 mb-1">
        <span className={`${labelBase} mb-0 truncate`} title={tooltip}>
          {def.label}
          {def.unit ? <span className="text-gray-600">（{def.unit}）</span> : null}
        </span>
        {showToggle && (
          <button
            type="button"
            onClick={onToggleInherit}
            disabled={disabled}
            title={inherit ? '当前不发射该参数，点击改为显式设置' : '点击恢复为不发射（跟随 llama-server 默认）'}
            className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              inherit
                ? 'border-gray-600 text-gray-500 hover:text-gray-300'
                : 'border-blue-500/60 text-blue-400 hover:bg-blue-500/10'
            }`}
          >
            {inherit ? '跟随默认' : '已显式设置'}
          </button>
        )}
        {deviated && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            title="恢复为启动器默认值"
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors"
          >
            恢复默认
          </button>
        )}
      </div>
      {children}
      {showDesc && def.desc && <div className={`${hintBase} mt-1`}>{def.desc}</div>}
    </div>
  );
}
