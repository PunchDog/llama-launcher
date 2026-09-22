// =============================================================================
// validate — 由元数据表推导的启动前校验
//   error：会让 llama-server 直接退出或行为错误；warning：能启动但大概率不是用户想要的
//   新增参数不要改这里，只有「跨参数/应用层」规则才需要手写
// =============================================================================

import type { Config, ConfigIssue } from '../types';
import type { AnyParamDef, RequireRule } from './schema';
import { ALL_PARAMS } from './index';
import { getPath, isInherit, ruleMet, unmetRequires } from './emit';

function checkOne(def: AnyParamDef, cfg: Config): ConfigIssue | null {
  const value = getPath(cfg, def.key);
  const err = (message: string): ConfigIssue => ({ field: def.key, message, severity: 'error' });

  if (isInherit(value)) {
    if (def.requiredWhen && matchesRule(def.requiredWhen.rule, cfg)) return err(def.requiredWhen.message);
    return null;
  }

  if (def.type === 'bool' && typeof value !== 'boolean') {
    return err(`${def.label} 必须是布尔值，当前 ${JSON.stringify(value)}`);
  }

  if (def.type === 'int' || def.type === 'float') {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return err(`${def.label} 必须是数字`);
    if (def.type === 'int' && !Number.isInteger(num)) return err(`${def.label} 必须是整数`);
    if (def.min !== undefined && num < def.min) return err(`${def.label} 不能小于 ${def.min}${def.unit ? ' ' + def.unit : ''}`);
    if (def.max !== undefined && num > def.max) return err(`${def.label} 不能大于 ${def.max}${def.unit ? ' ' + def.unit : ''}`);
  }

  if (def.type === 'enum' && def.options) {
    const allowed = def.options.map(String);
    const values = Array.isArray(value) ? value : [value];
    const bad = values.filter((v) => !allowed.includes(String(v)));
    if (bad.length) return err(`${def.label} 只接受 ${allowed.join(' / ')}，当前 ${bad.join(', ')}`);
  }

  if (def.validate) {
    const message = def.validate(value, cfg);
    if (message) return err(message);
  }
  return null;
}

function matchesRule(rule: RequireRule, cfg: Config): boolean {
  return ruleMet(rule, getPath(cfg, rule.key));
}

function crossChecks(cfg: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const push = (field: string, message: string, severity: ConfigIssue['severity']): void => {
    issues.push({ field, message, severity });
  };

  const ctx = getPath(cfg, 'model.ctx_size');
  const nPredict = getPath(cfg, 'model.n_predict');
  if (typeof ctx === 'number' && typeof nPredict === 'number' && nPredict > 0 && nPredict > ctx) {
    push('model.n_predict', `最大生成长度 ${nPredict} 超过上下文 ${ctx}，会被截断`, 'warning');
  }

  // llama-server 既没有 -m 也没有 --models-dir 时直接找不到可服务的模型
  if (isInherit(getPath(cfg, 'server.models_dir')) && isInherit(getPath(cfg, 'model.model'))) {
    push('server.models_dir', '模型目录与模型文件至少要设置一个，否则 llama-server 没有可加载的模型', 'error');
  }

  const endpoints = getPath(cfg, 'rpc.endpoints');
  if (Array.isArray(endpoints)) {
    endpoints.forEach((endpoint, i) => {
      if (typeof endpoint !== 'string' || !/^[^:/\s]+:\d+$/.test(endpoint)) {
        push(`rpc.endpoints.${i}`, `RPC 端点 ${String(endpoint)} 不是 host:port 形式`, 'error');
      }
    });
  }

  const rpcServer = getPath(cfg, 'rpc.server') as { enabled?: boolean; port?: number } | undefined;
  // 端口 0 会让 ggml-rpc-server 自行挑选端口，推导出的 --rpc 端点就对不上，按未设置处理
  if (rpcServer?.enabled) {
    const port = Number(rpcServer.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      push('rpc.server.port', '本地 rpc-server 需填写 1-65535 的监听端口', 'error');
    }
  }

  const args = getPath(cfg, 'extra.args');
  if (Array.isArray(args)) {
    args.forEach((arg, i) => {
      if (typeof arg !== 'string' || !arg.trim()) {
        push(`extra.args.${i}`, '追加原始参数里不能有空项', 'warning');
      }
    });
  }
  return issues;
}

export function validateParams(cfg: Config): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const def of ALL_PARAMS) {
    const issue = checkOne(def, cfg);
    if (issue) issues.push(issue);
    if (!isInherit(getPath(cfg, def.key)) && unmetRequires(def, cfg)) {
      const deps = (def.requires ?? []).map((r) => r.key).join('、');
      issues.push({
        field: def.key,
        message: `${def.label} 需要 ${deps} 为特定值才会生效，当前设置不会发射`,
        severity: 'warning',
      });
    }
  }
  issues.push(...crossChecks(cfg));
  return issues;
}

export function hasErrors(issues: readonly ConfigIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
