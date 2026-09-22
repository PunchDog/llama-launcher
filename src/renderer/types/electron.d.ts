import type { InvokeChannel, ReceiveChannel } from '../../shared/ipc-contract';

// window.electronAPI 类型 — 与 preload/index.ts 实际暴露的 API 一一对应，
// 通道名被约束在 shared/ipc-contract.ts 白名单内。
// invoke 返回主进程的统一封套 IpcEnvelope，业务代码不要直接调用本接口，
// 一律通过 hooks/api.ts 的 invoke()/on() 拆封与抛错。

interface ElectronAPI {
  invoke(channel: InvokeChannel, ...args: unknown[]): Promise<unknown>;
  on(
    channel: ReceiveChannel,
    callback: (...args: never[]) => void,
  ): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
