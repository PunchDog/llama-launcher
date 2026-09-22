import { useEffect, useRef, useState } from 'react';
import { inputBase } from './styles';

// =============================================================================
// NumberWithUnit — 数字参数输入
//   用 type="text" + 自建文本缓冲，而不是 type="number"：
//   原生数字框在受控模式下会把 "0." 吞成 "0"、无法输入负号、清空后强制变 0，
//   这三点都会毁掉三态参数（清空＝跟随默认）。
//   提交时机：文本能解析成有限数字才 onChange；越界值不落库，失焦时回退并提示。
// =============================================================================

interface NumberWithUnitProps {
  /** null 表示三态参数处于 inherit（输入框留空） */
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位（>0 按浮点解析，否则按整数解析） */
  precision?: number;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  /** 单位后缀，如 'tokens'；仅展示，不参与解析 */
  unit?: string;
}

/** 允许输入过程中的中间态：'-'、'1.'、'.5' 都算合法文本但不提交 */
function sanitize(raw: string, allowFloat: boolean): string {
  const cleaned = raw.replace(allowFloat ? /[^\d.-]/g : /[^\d-]/g, '');
  const negative = cleaned.startsWith('-');
  const digits = cleaned.slice(negative ? 1 : 0);
  const dotIndex = digits.indexOf('.');
  const kept = allowFloat
    ? dotIndex === -1
      ? digits
      : digits.slice(0, dotIndex + 1) + digits.slice(dotIndex + 1).replace(/\./g, '')
    : digits.replace(/\./g, '');
  return `${negative ? '-' : ''}${kept}`;
}

function parse(text: string, allowFloat: boolean): number | null {
  if (text === '' || text === '-' || text === '.' || text === '-.') return null;
  const num = allowFloat ? Number(text) : parseInt(text, 10);
  return Number.isFinite(num) ? num : null;
}

export default function NumberWithUnit({
  value,
  onChange,
  min,
  max,
  step,
  precision = 0,
  placeholder,
  disabled = false,
  title,
  unit,
}: NumberWithUnitProps) {
  const allowFloat = precision > 0;
  const current = value ?? null;
  const [text, setText] = useState(current === null ? '' : String(current));
  const [invalid, setInvalid] = useState<string | null>(null);
  /**
   * 我们最后一次交给父级的值。外部值只有在≠它时才回灌文本，
   * 这样输入中的 '1.'（提交的是 1）不会被自己的受控更新吃掉，
   * 也不必依赖 focus 事件（窗口不在前台时根本不发 focus）。
   */
  const lastCommitted = useRef<number | null>(current);

  useEffect(() => {
    if (value !== lastCommitted.current) {
      const next = value ?? null;
      lastCommitted.current = next;
      setText(next === null ? '' : String(next));
      setInvalid(null);
    }
  }, [value]);

  const commit = (num: number | null): void => {
    if (num === null) {
      setInvalid(null);
      lastCommitted.current = null;
      onChange(null);
      return;
    }
    if (typeof min === 'number' && num < min) {
      setInvalid(`不得小于 ${min}`);
      return;
    }
    if (typeof max === 'number' && num > max) {
      setInvalid(`不得大于 ${max}`);
      return;
    }
    const settled = allowFloat ? num : Math.trunc(num);
    setInvalid(null);
    lastCommitted.current = settled;
    onChange(settled);
  };

  const handleChange = (raw: string): void => {
    const next = sanitize(raw, allowFloat);
    setText(next);
    commit(parse(next, allowFloat));
  };

  const revert = (): void => {
    setText(current === null ? '' : String(current));
    setInvalid(null);
  };

  const handleBlur = (): void => {
    const num = parse(text, allowFloat);
    // 残缺输入（'-'、'0.'）或越界值：按当前生效值回填，别留下无法解析的文本
    if ((num === null && text !== '') || (num !== null && ((typeof min === 'number' && num < min) || (typeof max === 'number' && num > max)))) {
      revert();
      return;
    }
    commit(num);
  };

  const nudge = (dir: 1 | -1): void => {
    const base = value ?? 0;
    const size = step ?? (allowFloat ? 0.01 : 1);
    const next = Number((base + dir * size).toFixed(Math.max(precision, 0) || 6));
    setText(String(allowFloat ? next : Math.trunc(next)));
    commit(next);
  };

  return (
    <div className="relative">
      <input
        type="text"
        inputMode={allowFloat ? 'decimal' : 'numeric'}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        title={invalid ? `${title ?? ''} · ${invalid}` : title}
        aria-label={title ?? placeholder}
        onBlur={handleBlur}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            nudge(1);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            nudge(-1);
          }
        }}
        className={`${inputBase} ${unit ? 'pr-16' : ''} ${invalid ? 'border-red-500 focus:border-red-500 focus:ring-red-500/40' : ''}`}
      />
      {unit && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 pointer-events-none">
          {unit}
        </span>
      )}
      {invalid && <div className="text-[10px] text-red-400 mt-0.5">{invalid}</div>}
    </div>
  );
}
