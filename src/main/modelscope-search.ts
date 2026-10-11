// =============================================================================
// modelscope-search — ModelScope 站点模型检索（纯 API 层，无下载器状态）
//   注意：站点搜索接口（/dolphin/models）的 Query 参数实测被服务器忽略，
//   无论关键词是什么都返回同一批热门模型，因此不采用。
//   实测可靠的两种途径：
//     0. 输入含 "/"：
//        a. 按完整模型 ID 精确查询详情（GET /models/{id}）
//        b. 失败则按组织列出模型（PUT /models/ {Path: org}）+ 客户端按名称过滤
//     1. 输入视为组织名（如 Qwen / unsloth / deepseek-ai）→ 列出该组织全部模型
// =============================================================================

import axios from 'axios';
import type { ModelInfo } from '../shared/types';
import type { AxiosProxyConfig } from './net-util';

export const MODELSCOPE_API_BASE = 'https://modelscope.cn/api/v1';

/** 把路径按 '/' 分段编码，保留 owner/name 与子目录的层级结构 */
export function segEncode(p: string): string {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

/** 将 API 返回的原始条目统一为 ModelInfo（不同接口字段名有差异，防御性解析） */
function toModelInfo(m: Record<string, unknown>): ModelInfo {
  let id: string;
  if (typeof m.Id === 'string' && m.Id.includes('/')) {
    id = m.Id;
  } else if (typeof m.Path === 'string' && typeof m.Name === 'string' && m.Name) {
    id = `${m.Path}/${m.Name}`;
  } else {
    // dolphin 类接口 Id 为数字，真实模型 ID 在 BackendSupport.model_id 中
    const backend = m.BackendSupport as Record<string, unknown> | undefined;
    if (backend && typeof backend.model_id === 'string') id = backend.model_id;
    else id = typeof m.Name === 'string' ? m.Name : '';
  }
  let task: string | undefined;
  if (typeof m.Task === 'string') task = m.Task;
  else if (Array.isArray(m.Tasks) && m.Tasks.length > 0) {
    const t0 = m.Tasks[0] as Record<string, unknown>;
    task = typeof t0?.Name === 'string' ? t0.Name : undefined;
  }
  return {
    id,
    downloads: typeof m.Downloads === 'number' ? m.Downloads : undefined,
    task,
    summary: typeof m.Summary === 'string' ? m.Summary : undefined,
  };
}

/** 从各接口可能的响应路径中取出模型条目数组 */
function extractModelList(data: unknown): Record<string, unknown>[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const model = d.Model as Record<string, unknown> | undefined;
  const candidates = [model?.Models, d.Models, d.models, d];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c as Record<string, unknown>[];
  }
  return [];
}

/** 从响应 Data 中提取总数字段（组织列表接口返回 TotalCount） */
function extractTotal(data: unknown): number {
  const d = (data ?? {}) as Record<string, unknown>;
  const model = d.Model as Record<string, unknown> | undefined;
  const t = d.TotalCount ?? model?.TotalCount;
  return typeof t === 'number' ? t : 0;
}

/** 提取查询关键词的有效 token（长度≥3），用于结果相关性过滤 */
function queryTokens(kw: string): string[] {
  return kw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** 相关性校验：结果 id/摘要至少包含一个查询 token，过滤无匹配时返回的热门推荐噪音 */
function isRelevant(m: ModelInfo, tokens: string[], rawLower: string): boolean {
  const hay = `${m.id} ${m.summary ?? ''}`.toLowerCase();
  return hay.includes(rawLower) || tokens.some((t) => hay.includes(t));
}

/** 去重（按模型 ID） */
function dedupe(list: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/**
 * 按组织/所有者列出全部模型（PUT /models/ {Path}，官方 SDK 用法，实测真实过滤）。
 * 分页拉取直至取满 TotalCount，不做条数截断（上限 40 页 × 50 条作安全阀）。
 */
async function listByOwner(owner: string, proxy: AxiosProxyConfig | false): Promise<ModelInfo[]> {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'llama-launcher/1.0',
  };
  const pageSize = 50;
  const all: ModelInfo[] = [];
  for (let page = 1; page <= 40; page++) {
    const resp = await axios.put(
      `${MODELSCOPE_API_BASE}/models/`,
      { Path: owner, PageNumber: page, PageSize: pageSize },
      { headers, timeout: 30000, proxy },
    );
    const data = resp.data?.Data;
    const items = extractModelList(data)
      .map((m) => toModelInfo(m))
      .filter((x) => x.id);
    all.push(...items);
    const total = extractTotal(data);
    if (items.length < pageSize || (total > 0 && all.length >= total)) break;
  }
  return dedupe(all);
}

export async function searchModels(
  keyword: string,
  proxy: AxiosProxyConfig | false,
  setStatus: (msg: string) => void,
): Promise<ModelInfo[]> {
  const raw = keyword.trim();
  if (!raw) {
    throw new Error('请输入组织名（如 Qwen / unsloth / deepseek-ai）或完整模型 ID（如 Qwen/Qwen2.5-7B-Instruct）');
  }
  // 用户可能直接粘贴模型文件名（如 xxx-Q4_K_M.gguf），去掉扩展名再搜索
  const kw = raw.replace(/\.(gguf|safetensors|bin|pth|onnx)$/i, '');
  setStatus(`搜索模型: ${kw}`);

  // 策略 0：完整模型 ID
  if (kw.includes('/')) {
    // 0a. 精确查询
    try {
      const resp = await axios.get(
        `${MODELSCOPE_API_BASE}/models/${segEncode(kw)}`,
        { timeout: 30000, proxy },
      );
      const data = (resp.data?.Data ?? resp.data) as Record<string, unknown>;
      const info = toModelInfo(data);
      if (info.id) {
        setStatus('找到 1 个模型');
        return [info];
      }
    } catch {
      // ID 不存在，转 0b 按组织模糊匹配
    }

    // 0b. 按组织列出 + 按名称过滤
    const [org, ...restParts] = kw.split('/');
    const rest = restParts.join('/');
    try {
      const list = await listByOwner(org, proxy);
      const tokens = queryTokens(rest);
      const filtered = tokens.length
        ? list.filter((m) => isRelevant(m, tokens, rest.toLowerCase()))
        : list;
      if (filtered.length) {
        setStatus(`找到 ${filtered.length} 个模型`);
        return filtered;
      }
    } catch {
      // 组织也不存在，落到底部报错
    }
    throw new Error(`未找到模型「${raw}」：请确认模型 ID 是否正确（组织 ${org} 下无匹配项）`);
  }

  // 策略 1：关键词搜索（PUT /dolphin/models {Name: kw}，实测真实过滤；
  // 注意 Query 参数被服务器忽略，必须用 Name）
  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'llama-launcher/1.0',
    };
    const pageSize = 50;
    const all: ModelInfo[] = [];
    for (let page = 1; page <= 20; page++) {
      const resp = await axios.put(
        `${MODELSCOPE_API_BASE}/dolphin/models`,
        { Name: kw, PageNumber: page, PageSize: pageSize, SortBy: 'Default' },
        { headers, timeout: 30000, proxy },
      );
      const data = resp.data?.Data;
      const items = extractModelList(data)
        .map((m) => toModelInfo(m))
        .filter((x) => x.id);
      all.push(...items);
      const total = extractTotal(data);
      if (items.length < pageSize || (total > 0 && all.length >= total)) break;
    }
    const tokens = queryTokens(kw);
    const list = all
      .filter((x) => isRelevant(x, tokens, kw.toLowerCase()))
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
    if (list.length) {
      setStatus(`找到 ${list.length} 个模型`);
      return list;
    }
  } catch {
    // 转策略 2
  }

  // 策略 2：输入视为组织名（如 Qwen / unsloth / deepseek-ai）
  try {
    const list = await listByOwner(kw, proxy);
    if (list.length) {
      const sorted = [...list].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      setStatus(`找到 ${sorted.length} 个模型（${kw} 组织）`);
      return sorted;
    }
  } catch {
    // 落到底部报错
  }

  throw new Error(
    `未找到组织「${kw}」：请输入组织名（如 Qwen / unsloth / deepseek-ai）或完整模型 ID（如 Qwen/Qwen2.5-7B-Instruct）`,
  );
}
