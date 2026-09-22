import { useEffect, useRef, useState } from 'react';
import { btnGhost } from './styles';
import { showToast } from '@/renderer/stores/uiStore';

// =============================================================================
// CopyButton — 复制按钮：成功变「已复制」并在 1.5s 后复原
//   navigator.clipboard 在 Electron 里可能因焦点/权限失败，降级 execCommand
// =============================================================================

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('剪贴板不可用');
  }
}

export default function CopyButton({ text, label = '复制', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      type="button"
      className={`${btnGhost} ${className}`}
      onClick={() => {
        void writeClipboard(text).then(
          () => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          },
          (err: unknown) => showToast('error', `复制失败：${err instanceof Error ? err.message : String(err)}`),
        );
      }}
    >
      {copied ? '已复制' : label}
    </button>
  );
}
