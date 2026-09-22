// =============================================================================
// emit — 由元数据表生成 llama-server 命令行
//   这里不允许出现任何具体参数名：新增参数只改 groups/*.ts
//   发射顺序 = 组声明顺序，extra.args（raw）永远排在最后，用于压住前面的 UI 值
// =============================================================================

import type { AnyParamDef, RequireRule } from './schema';

/** 读取点路径值；中途遇到非对象返回 undefined（视作 inherit） */
export function getPath(root: unknown, key: string): unknown {
  let current: unknown = root;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 写入点路径值（调用方需保证中间对象已存在） */
export function setPath(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let target: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`配置路径 ${key} 的中间节点 ${part} 不是对象`);
    }
    target = next as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

/** 写入点路径值，缺失的中间对象自动创建 — 仅用于拼装新结构（如迁移后的预设） */
export function setDeep(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let target: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      target[part] = {};
    }
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

/**
 * inherit 判定：null/undefined、空串、空数组都不发射。
 * 空串按 inherit 处理是为了对齐旧版 `if (cfg.xxx)` 的语义（如 api_key/models_dir），
 * 也避免把 `--api-key ''` 这种会吞掉后续参数的形态发射出去。
 */
export function isInherit(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

function formatValue(def: AnyParamDef, value: unknown): string {
  if (typeof value === 'number') {
    return def.precision && def.precision > 0 ? value.toFixed(def.precision) : String(value);
  }
  return String(value);
}

export function ruleMet(rule: RequireRule, actual: unknown): boolean {
  // 与 requires 目标比较时一律按字符串比，避免 1 与 '1' 这类来源差异导致漏发射
  const hit = (list: readonly unknown[]) =>
    list.some((allowed) => String(allowed) === String(actual ?? ''));
  if (rule.oneOf) return hit(rule.oneOf);
  if (rule.noneOf) return !hit(rule.noneOf);
  return true;
}

function requiresMet(def: AnyParamDef, cfg: unknown): boolean {
  if (!def.requires) return true;
  return def.requires.every((rule) => ruleMet(rule, getPath(cfg, rule.key)));
}

/** requires 未满足的显式值 — 校验时给出 warning，避免用户以为参数生效了 */
export function unmetRequires(def: AnyParamDef, cfg: unknown): boolean {
  return !isInherit(getPath(cfg, def.key)) && !requiresMet(def, cfg);
}

export function buildArgs(defs: readonly AnyParamDef[], cfg: unknown): string[] {
  const args: string[] = [];
  const raw: string[] = [];

  for (const def of defs) {
    const value = getPath(cfg, def.key);
    if (isInherit(value)) continue;
    // 布尔参数默认就是裸开关，省掉每张表里的 emit: 'flagIfTrue'
    const kind = def.emit ?? (def.type === 'bool' ? 'flagIfTrue' : 'value');
    if (kind === 'none') continue;
    if (!requiresMet(def, cfg)) continue;
    if (kind === 'raw') {
      for (const item of value as unknown[]) {
        const text = String(item).trim();
        if (text) raw.push(text);
      }
      continue;
    }
    if (!def.flag) continue;

    switch (kind) {
      case 'flagIfTrue': {
        if (value === true || value === 'true') args.push(def.flag);
        else if (def.negFlag && (value === false || value === 'false')) args.push(def.negFlag);
        break;
      }
      case 'csv': {
        const items = (value as unknown[]).map((item) => formatValue(def, item));
        if (items.length) args.push(def.flag, items.join(','));
        break;
      }
      case 'repeat': {
        for (const item of value as unknown[]) args.push(def.flag, formatValue(def, item));
        break;
      }
      case 'spread': {
        args.push(def.flag, ...(value as unknown[]).map((item) => formatValue(def, item)));
        break;
      }
      case 'value': {
        args.push(def.flag, formatValue(def, value));
        break;
      }
    }
  }

  return [...args, ...raw];
}
