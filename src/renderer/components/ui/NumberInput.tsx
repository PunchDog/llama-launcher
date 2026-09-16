import { inputBase } from './styles';

// =============================================================================
// NumberInput — 数字输入（可选小数步进）
// =============================================================================

interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位（>0 时按浮点解析，否则按整数解析） */
  precision?: number;
  disabled?: boolean;
  title?: string;
}

export default function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  precision = 0,
  disabled = false,
  title,
}: NumberInputProps) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? (precision > 0 ? 0.01 : 1)}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(precision > 0 ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0);
      }}
      className={inputBase}
    />
  );
}
