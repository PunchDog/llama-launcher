import { useEffect, useRef, useState } from 'react';
import { inputBase, btnGhost } from './styles';

// =============================================================================
// JsonEditor — JSON 字符串参数编辑器（--chat-template-kwargs / --json-schema）
//   值在 config 里仍是字符串（命令行按原样发射），编辑期用本地缓冲：
//   只有解析成功（或清空）才上报，边打边校验，不会因为半个 `{` 就写坏配置。
// =============================================================================

interface JsonEditorProps {
  /** 当前字符串值；'' 表示三态 inherit */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  rows?: number;
}

export default function JsonEditor({
  value,
  onChange,
  placeholder = '{"key": "value"}',
  disabled = false,
  title,
  rows = 4,
}: JsonEditorProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value);
      lastEmitted.current = value;
      setError(null);
    }
  }, [value]);

  const validate = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    try {
      JSON.parse(trimmed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  const handleChange = (raw: string): void => {
    setText(raw);
    const issue = validate(raw);
    setError(issue);
    if (!issue) {
      const next = raw.trim();
      lastEmitted.current = next;
      onChange(next);
    }
  };

  return (
    <div>
      <textarea
        rows={rows}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        title={title}
        spellCheck={false}
        onChange={(e) => handleChange(e.target.value)}
        className={`${inputBase} font-mono resize-y ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/40' : ''}`}
      />
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className={`text-[10px] leading-tight ${error ? 'text-red-400' : 'text-gray-600'}`}>
          {error ? `JSON 无效：${error}` : '解析成功后才会写入配置'}
        </span>
        <button
          type="button"
          disabled={disabled || !!error || text.trim() === ''}
          className={btnGhost}
          onClick={() => {
            try {
              const pretty = JSON.stringify(JSON.parse(text), null, 2);
              handleChange(pretty);
            } catch {
              // 按钮在 error 时已禁用，这里只是双保险
            }
          }}
        >
          格式化
        </button>
      </div>
    </div>
  );
}
