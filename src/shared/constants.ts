import { Config, ConfigPreset } from './types';

// =============================================================================
// 全局常量 — 所有值均为只读
// =============================================================================

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

export const GITHUB_API_REPO_URL =
  'https://api.github.com/repos/ggml-org/llama.cpp';

export const GITHUB_API_URL = `${GITHUB_API_REPO_URL}/releases/latest`;

// ---------------------------------------------------------------------------
// 目录名
// ---------------------------------------------------------------------------

export const CORE_DIR_NAME = 'core';
export const DOWNLOAD_DIR_NAME = 'downloads';

// ---------------------------------------------------------------------------
// OS → Asset 搜索关键词（OS + GPU 后端组合）
// ---------------------------------------------------------------------------

export type GpuBackend = 'vulkan' | 'rocm';

/** 可选的 GPU 后端列表 */
export const BACKEND_OPTIONS: readonly GpuBackend[] = ['vulkan', 'rocm'] as const;

/** 后端 → 显示名称 */
export const BACKEND_LABEL_MAP: Record<GpuBackend, string> = {
  vulkan: 'Vulkan',
  rocm: 'ROCm',
};

/** 检查指定后端在当前平台上是否可用 */
export function isBackendAvailable(backend: GpuBackend, platform: string): boolean {
  const keyword = getBackendKeyword(backend, platform);
  return keyword !== '';
}

/** OS + 后端 → 搜索关键词 */
export function getBackendKeyword(backend: GpuBackend, platform: string): string {
  const platformStr = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const map: Record<string, Record<string, string>> = {
    vulkan: {
      windows: 'bin-win-vulkan',
      linux: 'bin-ubuntu-vulkan',  // 匹配 llama-b*-bin-ubuntu-vulkan-x64.tar.gz
      darwin: 'bin-macos-vulkan',
    },
    rocm: {
      windows: 'bin-win-rocm',     // 匹配 llama-b*-bin-win-rocm-10.0-x64.zip
      linux: 'bin-ubuntu-rocm',    // 不匹配 ubuntu-vulkan
      darwin: '',                  // macOS 无 ROCm
    },
  };
  return map[backend]?.[platformStr] ?? '';
}

/** OS + 后端 → 显示标签 */
export function getBackendLabel(backend: GpuBackend, platform: string): string {
  const platformStr = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
  const backendLabel = BACKEND_LABEL_MAP[backend] ?? backend;
  return `${platformStr} ${backendLabel}`;
}

// ---------------------------------------------------------------------------
// 枚举选项
// ---------------------------------------------------------------------------

export const FLASH_ATTN_OPTIONS: readonly string[] = [
  'auto',
  'on',
  'off',
] as const;

export const CACHE_TYPE_OPTIONS: readonly string[] = [
  'f16',
  'f32',
  'q8_0',
  'q4_0',
] as const;

export const POOLING_OPTIONS: readonly string[] = [
  'none',
  'mean',
  'cls',
  'last',
] as const;

export const LOG_FORMAT_OPTIONS: readonly string[] = [
  'text',
  'json',
] as const;

// ---------------------------------------------------------------------------
// --spec-type 全部取值（来源：llama.cpp docs/speculative.md 官方枚举）
//   needsDraftMax:  是否需要 --spec-draft-n-max 输入框（draft-* 类需要）
//   needsDraftModel: 是否需要 --spec-draft-model 草稿模型文件
//     （draft-mtp 使用主模型自带 MTP 头，无需草稿文件）
// ---------------------------------------------------------------------------

export interface SpecTypeOption {
  value: string;
  label: string;
  desc: string;
  needsDraftMax: boolean;
  needsDraftModel: boolean;
}

export const SPEC_TYPES: readonly SpecTypeOption[] = [
  { value: 'none', label: 'none', desc: '不使用投机解码（默认）', needsDraftMax: false, needsDraftModel: false },
  // 草稿模型类
  { value: 'draft-simple', label: 'draft-simple', desc: '简单草稿模型（需 --spec-draft-model）', needsDraftMax: true, needsDraftModel: true },
  { value: 'draft-eagle3', label: 'draft-eagle3', desc: 'EAGLE-3 草稿模型，读取目标模型隐藏状态', needsDraftMax: true, needsDraftModel: true },
  { value: 'draft-dflash', label: 'draft-dflash', desc: 'DFlash/DFlash2 块扩散草稿模型（PR #27342）', needsDraftMax: true, needsDraftModel: true },
  { value: 'draft-dspark', label: 'draft-dspark', desc: 'DSpark：DFlash 骨干 + 半自回归 Markov 头（仅 Qwen3）', needsDraftMax: true, needsDraftModel: true },
  { value: 'draft-mtp', label: 'draft-mtp', desc: '使用主模型自带的 Multi Token Prediction (MTP) 头', needsDraftMax: true, needsDraftModel: false },
  // n-gram 类（无需草稿模型）
  { value: 'ngram-cache', label: 'ngram-cache', desc: 'n-gram 缓存统计查询', needsDraftMax: false, needsDraftModel: false },
  { value: 'ngram-simple', label: 'ngram-simple', desc: '简单 n-gram 模式匹配', needsDraftMax: false, needsDraftModel: false },
  { value: 'ngram-map-k', label: 'ngram-map-k', desc: 'n-gram 模式匹配（哈希映射 + 命中计数）', needsDraftMax: false, needsDraftModel: false },
  { value: 'ngram-map-k4v', label: 'ngram-map-k4v', desc: 'n-gram 匹配 + 每键最多 4 个值（实验性）', needsDraftMax: false, needsDraftModel: false },
  { value: 'ngram-mod', label: 'ngram-mod', desc: '基础 n-gram 哈希池（跨 slot 共享）', needsDraftMax: false, needsDraftModel: false },
] as const;

/** 判断 spec 类型是否需要 --spec-draft-n-max（draft-* 类） */
export function needsDraftMax(specType: string): boolean {
  return SPEC_TYPES.find((t) => t.value === specType)?.needsDraftMax ?? specType.startsWith('draft-');
}

/** 判断 spec 类型是否需要 --spec-draft-model 草稿模型文件（draft-mtp 除外） */
export function needsDraftModel(specType: string): boolean {
  return SPEC_TYPES.find((t) => t.value === specType)?.needsDraftModel ?? false;
}

// ---------------------------------------------------------------------------
// 默认参数预设 — 针对 Qwen3.8-27B-UD-Q5_K_XL + DFlash2 投机解码
//   目标环境：AMD Ryzen AI Max+ 395（Strix Halo，128GB 统一内存）
//   存于 config.json 顶层 presets 字段，用户可手动编辑增删
// ---------------------------------------------------------------------------

const STRIX_HALO_HINT =
  '适用 AI Max+ 395 / 128GB 统一内存：Windows 请用 Vulkan 后端，BIOS 开启 Resizable BAR 并将 UMA 显存调至最大；驱动识别异常时设置 HSA_OVERRIDE_GFX_VERSION=11.0.3';

export const DEFAULT_PRESETS: readonly ConfigPreset[] = [
  {
    id: 'qwen38-27b-dflash2-balanced-128k',
    name: 'Qwen3.8-27B + DFlash2 · 平衡 128K',
    desc: '上下文 131072、KV q8_0、批 2048、Draft N=8 — 日常编码与长文首选',
    hint: STRIX_HALO_HINT,
    config: {
      ctx_size: 131072,
      n_predict: 32768,
      batch_size: 2048,
      tensor_batch: 256,
      parallel: 4,
      threads: 16,
      ngl: 999,
      flash_attn: 'on',
      cache_type_k: 'q8_0',
      cache_type_v: 'q8_0',
      spec_type: 'draft-dflash',
      mtp: 8,
      spec_draft_ngl: 'all',
    },
  },
  {
    id: 'qwen38-27b-dflash2-max-262k',
    name: 'Qwen3.8-27B + DFlash2 · 极限 262K',
    desc: '上下文 262144、KV q8_0、批 1024、Draft N=6 — 超长代码库与整本项目',
    hint: STRIX_HALO_HINT,
    config: {
      ctx_size: 262144,
      n_predict: 65536,
      batch_size: 1024,
      tensor_batch: 256,
      parallel: 2,
      threads: 16,
      ngl: 999,
      flash_attn: 'on',
      cache_type_k: 'q8_0',
      cache_type_v: 'q8_0',
      spec_type: 'draft-dflash',
      mtp: 6,
      spec_draft_ngl: 'all',
    },
  },
  {
    id: 'qwen38-27b-dflash2-speed-32k',
    name: 'Qwen3.8-27B + DFlash2 · 极速 32K',
    desc: '上下文 32768、KV f16、批 4096、Draft N=12 — 追求最高解码速度',
    hint: STRIX_HALO_HINT,
    config: {
      ctx_size: 32768,
      n_predict: 8192,
      batch_size: 4096,
      tensor_batch: 512,
      parallel: 8,
      threads: 16,
      ngl: 999,
      flash_attn: 'on',
      cache_type_k: 'f16',
      cache_type_v: 'f16',
      spec_type: 'draft-dflash',
      mtp: 12,
      spec_draft_ngl: 'all',
    },
  },
] as const;

// ---------------------------------------------------------------------------
// 默认配置（Config 类型，与 Go 版 DefaultConfig() 完全一致）
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Config = {
  models_dir: 'D:\\models\\lmstudio-community',
  models_max: 2,
  timeout: 3600,
  host: '0.0.0.0',
  port: 8080,
  api_key: '',
  ngl: 999,
  flash_attn: 'on',
  cache_type_k: 'f16',
  cache_type_v: 'f16',
  threads: 8,
  batch_size: 8192,
  ctx_size: 262144,
  n_predict: 131072,
  parallel: 8,
  metrics: true,
  tensor_batch: 16,
  kv_unified: true,
  mtp: 0,
  spec_type: 'none',
  spec_draft_model: '',
  spec_draft_ngl: 'auto',
  proxy_enabled: true,
  proxy_url: '',
  optional: {
    model: '',
    cont_batching: false,
    log_format: '',
    log_disable: false,
    verbose: false,
    mlock: false,
    no_mmap: false,
    embedding: false,
    pooling: 'none',
    rope_scaling: '',
    rope_freq_base: 0,
    rope_freq_scale: 0,
    numa: false,
    low_vram: false,
    tfs_z: 1.0,
    top_k: 20,
    top_p: 0.95,
    min_p: 0,
    temperature: 0.4,
    repeat_penalty: 1.1,
    repeat_last_n: 64,
    presence_penalty: 0,
    frequency_penalty: 0,
    jinja: true,
    chatTemplateKwargs: '{"preserve_thinking":true}',
  },
  rpc_server: {
    enabled: false,
    host: '127.0.0.1',
    port: 5555,
    workers: 4,
    timeout: 300,
  },
  presets: DEFAULT_PRESETS as ConfigPreset[],
};
