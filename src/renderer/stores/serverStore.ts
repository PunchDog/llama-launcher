// =============================================================================
// serverStore — llama-server 进程状态
//   状态来自 server:state-changed 推送（bridge 唯一订阅点），
//   本 store 只在挂载/心跳时主动 refresh 一次做兜底。
// =============================================================================

import { create } from 'zustand';
import type { Config, ServerState } from '@/shared/types';
import { invoke } from '@/renderer/hooks/api';
import { useConfigStore } from './configStore';
import { showToast } from './uiStore';

interface ServerStore {
  state: ServerState;
  /** 启停请求进行中，用于禁用按钮 */
  busy: boolean;
  error: string | null;
  applyState: (state: ServerState) => void;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  getCommand: () => Promise<string>;
  previewCommand: (cfg?: Config) => Promise<string>;
}

export const useServerStore = create<ServerStore>((set) => {
  /** 真正执行一次启停：先把未落盘的配置冲刷掉，否则主进程读到的是旧值 */
  async function run(action: 'start' | 'stop' | 'restart'): Promise<void> {
    set({ busy: true, error: null });
    try {
      if (action !== 'stop' && !(await useConfigStore.getState().flushNow())) {
        throw new Error('配置未保存成功，已中止启动');
      }
      await invoke(`server:${action}`);
      // 主进程随后会推 server:state-changed，这里不自己猜状态
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg, busy: false });
      showToast('error', msg);
      throw err;
    } finally {
      set({ busy: false });
    }
  }

  return {
    state: 0 as ServerState,
    busy: false,
    error: null,

    applyState: (state) => set({ state, busy: false }),

    refresh: async () => {
      try {
        set({ state: await invoke('server:get-state') });
      } catch {
        // 主进程还没起来时静默，下一次心跳会再试
      }
    },

    start: () => run('start'),
    stop: () => run('stop'),
    restart: () => run('restart'),

    getCommand: async () => await invoke('server:get-command'),

    previewCommand: async (cfg) => {
      const target = cfg ?? useConfigStore.getState().config;
      if (!target) throw new Error('配置尚未加载');
      return await invoke('server:preview-command', target);
    },
  };
});
