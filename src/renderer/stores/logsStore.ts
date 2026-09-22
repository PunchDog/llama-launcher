// =============================================================================
// logsStore — 运行日志环形缓冲
//   数组常驻模块作用域，追加只做 push + 裁剪，绝不整份复制；
//   响应式侧只暴露一个递增的 seq，订阅者拿到 seq 后再按需 slice 渲染，
//   避免每行日志都重建 5000 项数组或 join 成字符串。
// =============================================================================

import { create } from 'zustand';
import { MAX_LOG_BUFFER } from '@/shared/constants';

/** 超出上限后一次性裁到 90%，避免每行都 splice */
const TRIM_TO = Math.floor(MAX_LOG_BUFFER * 0.9);

const buffer: string[] = [];

interface LogsStore {
  /** 每次批量追加后自增，驱动订阅者重渲染 */
  seq: number;
  appendBatch: (lines: readonly string[]) => void;
  /** 首次挂载时把主进程的历史日志接在前面 */
  seed: (history: readonly string[]) => void;
  clear: () => void;
}

export const useLogsStore = create<LogsStore>((set, get) => ({
  seq: 0,

  appendBatch: (lines) => {
    if (lines.length === 0) return;
    for (const line of lines) {
      if (line === '') continue;
      for (const part of line.split('\n')) {
        if (part !== '') buffer.push(part);
      }
    }
    trim();
    set({ seq: get().seq + 1 });
  },

  seed: (history) => {
    if (buffer.length > 0 || history.length === 0) return;
    for (const line of history) {
      for (const part of line.split('\n')) {
        if (part !== '') buffer.push(part);
      }
    }
    trim();
    set({ seq: get().seq + 1 });
  },

  clear: () => {
    buffer.length = 0;
    set({ seq: get().seq + 1 });
  },
}));

function trim(): void {
  if (buffer.length > MAX_LOG_BUFFER) buffer.splice(0, buffer.length - TRIM_TO);
}

/** 非响应式快照：渲染层在 rAF 回调里读取，再自行决定切片范围 */
export function logLines(): readonly string[] {
  return buffer;
}
