import { inputBase, monoInput } from './styles';

// =============================================================================
// TextInput — 文本输入（支持等宽字体、只读展示）
// =============================================================================

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  title?: string;
  /** 失焦回调（如代理地址保存） */
  onBlur?: () => void;
}

export default function TextInput({
  value,
  onChange,
  placeholder,
  mono = false,
  readOnly = false,
  disabled = false,
  title,
  onBlur,
}: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      title={title}
      className={mono ? monoInput : inputBase}
    />
  );
}
