import { monoInput, btnSecondary } from './styles';

// =============================================================================
// PathInput — 路径输入 + "..." 选择按钮
//   onPick 由页面注入（dialog:open-folder / dialog:open-file）
// =============================================================================

interface PathInputProps {
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  title?: string;
}

export default function PathInput({
  value,
  onChange,
  onPick,
  placeholder,
  readOnly = false,
  disabled = false,
  title,
}: PathInputProps) {
  return (
    <div className="flex gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        title={title ?? value}
        className={`${monoInput} flex-1 min-w-0`}
      />
      <button type="button" onClick={onPick} disabled={disabled} className={`${btnSecondary} py-1`}>
        ...
      </button>
    </div>
  );
}
