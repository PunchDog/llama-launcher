import { labelBase, hintBase } from './styles';

// =============================================================================
// Field — 标签 + 控件容器（含补充说明）
// =============================================================================

interface FieldProps {
  label?: string;
  /** 标签下方说明文字 */
  hint?: string;
  /** 栅格跨列（如 span={2}） */
  span?: number;
  children: React.ReactNode;
}

// Tailwind 需要静态类名，动态拼接（col-span-${n}）不会被扫描生成
const SPAN_CLASS: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-3',
  4: 'col-span-4',
};

export default function Field({ label, hint, span, children }: FieldProps) {
  return (
    <div className={span ? SPAN_CLASS[span] : undefined}>
      {label && <div className={labelBase}>{label}</div>}
      {children}
      {hint && <div className={`${hintBase} mt-1`}>{hint}</div>}
    </div>
  );
}
