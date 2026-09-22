import type { Config, ConfigIssue } from '../shared/types';
import { ALL_PARAMS, buildArgs as buildArgsFromParams } from '../shared/params';
import { validateParams } from '../shared/params/validate';

// =============================================================================
// buildArgs / validateConfig — llama-server 命令行与启动前校验的主进程入口
//   参数表在 src/shared/params/groups/*.ts，这里只处理「无法用参数表表达」的两件事：
//   本机 rpc-server 开关推导默认端点、以及把元数据校验转发出来。
//   新增/修改参数一律改参数表，不要在本文件里硬编码 flag
// =============================================================================

/**
 * 「启用本机 rpc-server」是应用层开关，而 llama-server 只认 --rpc 端点列表。
 * 开关打开却没填端点时推导为本机监听地址，否则会出现「拉起了 rpc-server 却没让它参与推理」。
 */
function withDerivedRpcEndpoints(cfg: Config): Config {
  const server = cfg.rpc.server;
  const endpoints = cfg.rpc.endpoints ?? [];
  if (!server.enabled || endpoints.length > 0) return cfg;
  return { ...cfg, rpc: { ...cfg.rpc, endpoints: [`${server.host}:${server.port}`] } };
}

export function buildArgs(cfg: Config): string[] {
  return buildArgsFromParams(ALL_PARAMS, withDerivedRpcEndpoints(cfg));
}

export function validateConfig(cfg: Config): ConfigIssue[] {
  return validateParams(cfg);
}

// =============================================================================
// formatCmdline — 拼出可展示的命令行
//   redactSecrets=true 时 --api-key 的值显示为 ***，预览与实际命令共用本函数，
//   避免密钥出现在 UI / 日志里
// =============================================================================

export function formatCmdline(exePath: string, args: string[], redactSecrets = false): string {
  // 密钥类参数由参数表按类型标记（secret），不在此处点名
  const SECRET_FLAGS = new Set<string>();
  for (const def of ALL_PARAMS) {
    if (def.type !== 'secret') continue;
    for (const token of [def.flag, def.negFlag]) if (token) SECRET_FLAGS.add(token);
  }
  const out: string[] = [exePath];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (redactSecrets && SECRET_FLAGS.has(a) && i + 1 < args.length) {
      out.push(a, '***');
      i++;
      continue;
    }
    out.push(a);
  }
  return out.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
}
