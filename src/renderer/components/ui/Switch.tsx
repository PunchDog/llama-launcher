// =============================================================================
// Switch — 复选框开关（标签 + 可选说明）
// =============================================================================

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export default function Switch({ label, checked, onChange, disabled = false }: SwitchProps) {
  return (
    <label
      className={`flex items-center gap-2 text-sm text-gray-400 ${
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-500 w-3.5 h-3.5"
      />
      {label}
    </label>
  );
}
