// =============================================================================
// configStore — 渲染层唯一的 Config 来源
//   写路径：乐观改本地 config → 250ms 防抖合并成一次「整份 config:save」。
//   不再走 config:update 点路径通道，主进程因此不必接受任意路径写入；
//   保存成功以主进程归一化结果为准，失败回滚到 lastSaved 并弹 Toast。
// =============================================================================

import { create } from 'zustand';
import type { Config } from '@/shared/types';
import { setDeep } from '@/shared/params';
import { invoke } from '@/renderer/hooks/api';
import { showToast } from './uiStore';
import { errMsg } from '@/shared/errors';

/** 连续输入（如逐字符敲路径）只落一次盘 */
const SAVE_DEBOUNCE_MS = 250;

/** 只允许 group.field 形式的点路径，挡掉 __proto__ 等原型的写入 */
const SAFE_KEY = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/;

interface ConfigStore {
  config: Config | null;
  /** 最近一次主进程确认落盘的配置，失败时回滚到它 */
  lastSaved: Config | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setParam: (key: string, value: unknown) => void;
  setParams: (patch: Record<string, unknown>) => void;
  /** 立即把未保存的修改写盘；启动按钮调用，返回是否已确认落盘 */
  flushNow: () => Promise<boolean>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 每次本地修改自增；用于识别「响应途中用户又改了」的竞态 */
let revision = 0;

function clone(cfg: Config): Config {
  return structuredClone(cfg);
}

function writeKey(cfg: Config, key: string, value: unknown): void {
  if (!SAFE_KEY.test(key)) throw new Error(`非法的参数路径：${key}`);
  setDeep(cfg as unknown as Record<string, unknown>, key, value);
}

type PersistResult = 'clean' | 'saved' | 'stale' | 'error';

export const useConfigStore = create<ConfigStore>((set, get) => {
  async function persist(): Promise<PersistResult> {
    const start = get();
    if (!start.config) return 'error';
    if (start.config === start.lastSaved) return 'clean';
    const revAtStart = revision;
    try {
      const saved = await invoke('config:save', start.config);
      if (revision !== revAtStart) {
        // 保存期间用户又改了：这份响应不含最新修改，丢弃并按最新本地值再存一轮
        schedulePersist();
        return 'stale';
      }
      set({ config: saved, lastSaved: saved, error: null });
      return 'saved';
    } catch (err) {
      const msg = errMsg(err);
      const { lastSaved } = get();
      set({ config: lastSaved, error: msg });
      showToast('error', `配置保存失败，已回滚：${msg}`);
      return 'error';
    }
  }

  /** 写盘直到确认落盘（或被拒绝）；最多三轮，仍判 stale 说明用户在猛敲，交给防抖收尾 */
  async function persistUntilSettled(): Promise<boolean> {
    for (let i = 0; i < 3; i++) {
      const result = await persist();
      if (result === 'error') return false;
      if (result !== 'stale') return true;
    }
    return false;
  }

  function schedulePersist(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist();
    }, SAVE_DEBOUNCE_MS);
  }

  function applyLocal(next: Config): void {
    revision++;
    set({ config: next, error: null });
    schedulePersist();
  }

  return {
    config: null,
    lastSaved: null,
    loading: true,
    error: null,

    load: async () => {
      set({ loading: true, error: null });
      try {
        const cfg = await invoke('config:load');
        set({ config: cfg, lastSaved: cfg, loading: false });
      } catch (err) {
        const msg = errMsg(err);
        set({ loading: false, error: msg });
      }
    },

    setParam: (key, value) => {
      const { config } = get();
      if (!config) return;
      const next = clone(config);
      try {
        writeKey(next, key, value);
      } catch (err) {
        const msg = errMsg(err);
        set({ error: msg });
        showToast('error', msg);
        return;
      }
      applyLocal(next);
    },

    setParams: (patch) => {
      const { config } = get();
      if (!config) return;
      const next = clone(config);
      try {
        for (const [key, value] of Object.entries(patch)) writeKey(next, key, value);
      } catch (err) {
        const msg = errMsg(err);
        set({ error: msg });
        showToast('error', msg);
        return;
      }
      applyLocal(next);
    },

    flushNow: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      return await persistUntilSettled();
    },
  };
});
