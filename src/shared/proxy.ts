import type { Config } from './types';

// =============================================================================
// 代理生效规则 —— 渲染进程唯一判定处
//   开关开启且填写了地址才走代理；地址留空表示「不用代理」而不是「猜一个默认地址」，
//   因为默认 127.0.0.1:7890 不可达时下载会直接失败，用户看到的却是「网络错误」。
//   主进程侧只负责把 URL 解析成 axios/net 的 proxy 配置（net-util.resolveProxy）。
// =============================================================================

export function effectiveProxy(cfg: Pick<Config, 'proxy'> | null | undefined): string {
  if (!cfg?.proxy?.enabled) return '';
  return (cfg.proxy.url ?? '').trim();
}
