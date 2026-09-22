import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { btnGhost } from './styles';

// =============================================================================
// Modal — 受控弹层：Esc / 遮罩关闭，Tab 焦点圈在弹层内，关闭后焦点还给触发元素
// =============================================================================

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** 内容最大宽度类（Tailwind 需静态类名） */
  size?: 'md' | '3xl';
  /** 底部操作区，null 时不渲染 */
  footer?: React.ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  '3xl': 'max-w-3xl',
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, title, onClose, children, size = '3xl', footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose 每次渲染都是新函数时不应重跑订阅逻辑（会闪一下焦点），故走 ref
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // 焦点不在弹层内（浏览器刚把 Tab 移出）时先拉回，避免绕背景操作
      if (!panelRef.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-6 w-full mx-4 ${SIZE_CLASS[size]}`}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
            className={`${btnGhost} text-base leading-none`}
          >
            ×
          </button>
        </div>
        {children}
        {footer && <div className="flex gap-3 mt-4 justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
