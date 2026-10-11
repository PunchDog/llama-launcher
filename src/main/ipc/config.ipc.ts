import { loadConfig, saveConfig } from '../config';
import { safeHandle } from './registry';

// =============================================================================
// Config 通道 — 加载 / 整份保存（保存后主进程返回归一化配置，渲染层以它为准）
// =============================================================================

export function registerConfigIpc(): void {
  safeHandle('config:load', () => loadConfig());

  safeHandle('config:save', (_event, config) => saveConfig(config));
}
