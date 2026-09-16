import { inputBase } from './styles';

// =============================================================================
// SelectInput — 下拉选择（沿用原生 select 保证跨平台一致性）
// =============================================================================

export interface SelectOption {
  value: string;
  label: string;
  /** 悬浮说明 */
  title?: string;
}

interface SelectInputProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  title?: string;
}

export default function SelectInput({
  value,
  onChange,
  options,
  disabled = false,
  title,
}: SelectInputProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title={title}
      className={inputBase}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} title={opt.title}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
