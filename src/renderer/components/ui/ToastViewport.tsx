import { useUIStore, type ToastKind } from '@/renderer/stores/uiStore';

// =============================================================================
// ToastViewport — 右下角通知堆
//   配置回滚、启停失败等「一闪而过的反馈」走这里，不再往界面里塞常驻红字。
// =============================================================================

const KIND_CLASS: Record<ToastKind, string> = {
  info: 'border-gray-600 text-gray-200',
  success: 'border-green-600 text-green-300',
  error: 'border-red-600 text-red-300',
};

export default function ToastViewport() {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`text-left px-3 py-2 rounded border bg-gray-800 shadow-lg text-xs leading-relaxed transition-opacity hover:opacity-80 ${KIND_CLASS[t.kind]}`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
