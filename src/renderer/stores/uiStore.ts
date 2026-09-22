// =============================================================================
// uiStore — 界面偏好与 Toast 队列
//   折叠/层级/搜索词等纯视图状态放在这里：切页组件保持挂载时也能共享，
//   且各偏好写穿 localStorage，重启后保持。
// =============================================================================

import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

/** 偏好直接落 localStorage，不占用 config.json（那是 llama-server 的启动参数） */
const PREF_KEY = 'ui-prefs';

interface UIPrefs {
  maxTier: 0 | 1 | 2;
  onlyChanged: boolean;
  dockOpen: boolean;
  dockHeight: number;
}

const DEFAULT_PREFS: UIPrefs = { maxTier: 0, onlyChanged: false, dockOpen: true, dockHeight: 40 };

function loadPrefs(): UIPrefs {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UIPrefs>;
    return {
      maxTier: parsed.maxTier === 1 || parsed.maxTier === 2 ? parsed.maxTier : 0,
      onlyChanged: parsed.onlyChanged === true,
      dockOpen: parsed.dockOpen !== false,
      dockHeight: typeof parsed.dockHeight === 'number' ? Math.min(80, Math.max(15, parsed.dockHeight)) : 40,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function persistPrefs(s: UIPrefs): void {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(s));
  } catch {
    // 隐私模式下 localStorage 会抛，偏好丢失不影响功能
  }
}

interface UIStore extends UIPrefs {
  page: string;
  /** 参数页搜索词（不持久化，切页语义上是新的一次浏览） */
  search: string;
  toasts: ToastItem[];
  setPage: (page: string) => void;
  setSearch: (q: string) => void;
  setMaxTier: (tier: 0 | 1 | 2) => void;
  setOnlyChanged: (on: boolean) => void;
  setDockOpen: (open: boolean) => void;
  setDockHeight: (pct: number) => void;
  toast: (kind: ToastKind, text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;
const TOAST_TTL_MS = 4000;

export const useUIStore = create<UIStore>((set, get) => ({
  ...loadPrefs(),
  page: 'overview',
  search: '',
  toasts: [],

  setPage: (page) => set({ page }),
  setSearch: (search) => set({ search }),

  setMaxTier: (maxTier) => {
    set({ maxTier });
    persistPrefs(snapshotPrefs(get()));
  },

  setOnlyChanged: (onlyChanged) => {
    set({ onlyChanged });
    persistPrefs(snapshotPrefs(get()));
  },

  setDockOpen: (dockOpen) => {
    set({ dockOpen });
    persistPrefs(snapshotPrefs(get()));
  },

  setDockHeight: (pct) => {
    const dockHeight = Math.min(80, Math.max(15, Math.round(pct)));
    set({ dockHeight });
    persistPrefs(snapshotPrefs(get()));
  },

  toast: (kind, text) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => {
      const cur = get();
      if (cur.toasts.some((t) => t.id === id)) {
        set({ toasts: cur.toasts.filter((t) => t.id !== id) });
      }
    }, TOAST_TTL_MS);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

function snapshotPrefs(s: UIStore): UIPrefs {
  return { maxTier: s.maxTier, onlyChanged: s.onlyChanged, dockOpen: s.dockOpen, dockHeight: s.dockHeight };
}

/** 供其他 store 报错用，避免它们反向 import 本文件的 hook 类型 */
export function showToast(kind: ToastKind, text: string): void {
  useUIStore.getState().toast(kind, text);
}
