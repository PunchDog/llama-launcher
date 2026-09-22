import type { Config, ConfigPreset } from './types';
import { DEFAULT_PARAMS } from './params/index';

// =============================================================================
// 全局常量 — 所有值均为只读
//   llama-server 参数的候选值/默认值/校验一律来自 src/shared/params 元数据表，
//   本文件只放与参数无关的应用层常量（见 tests/params.metadata.mjs 的约束）
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
// 日志环形缓冲上限 — server.ts / log-worker.ts / 渲染层日志区共用单源
// ---------------------------------------------------------------------------

export const MAX_LOG_BUFFER = 5000;

// ---------------------------------------------------------------------------
// 配置结构版本 — config.json 顶层 config_version 字段，
//   config.ts 按版本号执行阶梯式迁移（每次 +1）
//   2 = 参数元数据层（全部参数三态化，值集中在按组嵌套的 ParamsConfig）
// ---------------------------------------------------------------------------

export const CONFIG_VERSION = 2;

// ---------------------------------------------------------------------------
// deepFreeze — 冻结默认配置/预设，防止任何调用方原地修改共享常量
// ---------------------------------------------------------------------------

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 架构标识 — 下载缓存文件名用，区分 x86 / arm 包避免互相覆盖
//   （renderer 环境无 process，用 typeof 守卫；主进程按真实架构取值）
// ---------------------------------------------------------------------------

export const ARCH_LABEL: string =
  typeof process !== 'undefined' && process.arch === 'arm64' ? 'arm' : 'x86';

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
  return getBackendKeyword(backend, platform) !== '';
}

/** OS + 后端 → 搜索关键词 */
export function getBackendKeyword(backend: GpuBackend, platform: string): string {
  const platformStr = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
  const map: Record<string, Record<string, string>> = {
    vulkan: {
      windows: 'bin-win-vulkan',
      // 精确匹配 x64 包（llama-b*-bin-ubuntu-vulkan-x64.tar.gz）；
      // 若只写 bin-ubuntu-vulkan，子串匹配会误命中 arm64 资产
      linux: 'bin-ubuntu-vulkan-x64',
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
// 默认参数预设 — 针对 Qwen3.8-27B-UD-Q5_K_XL + DFlash2 投机解码
//   目标环境：AMD Ryzen AI Max+ 395（Strix Halo，128GB 统一内存）
//   changes 的键为 ParamDef.key（点路径），只覆盖列出的参数，其余保持用户当前值
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
    changes: {
      'model.ctx_size': 131072,
      'model.n_predict': 32768,
      'model.batch_size': 2048,
      'server.parallel': 4,
      'compute.threads': 16,
      'memory.ngl': '999',
      'model.flash_attn': 'on',
      'memory.cache_type_k': 'q8_0',
      'memory.cache_type_v': 'q8_0',
      'speculative.spec_type': 'draft-dflash',
      'speculative.draft_n_max': 8,
      'speculative.draft_ngl': 'all',
    },
  },
  {
    id: 'qwen38-27b-dflash2-max-262k',
    name: 'Qwen3.8-27B + DFlash2 · 极限 262K',
    desc: '上下文 262144、KV q8_0、批 1024、Draft N=6 — 超长代码库与整本项目',
    hint: STRIX_HALO_HINT,
    changes: {
      'model.ctx_size': 262144,
      'model.n_predict': 65536,
      'model.batch_size': 1024,
      'server.parallel': 2,
      'compute.threads': 16,
      'memory.ngl': '999',
      'model.flash_attn': 'on',
      'memory.cache_type_k': 'q8_0',
      'memory.cache_type_v': 'q8_0',
      'speculative.spec_type': 'draft-dflash',
      'speculative.draft_n_max': 6,
      'speculative.draft_ngl': 'all',
    },
  },
  {
    id: 'qwen38-27b-dflash2-speed-32k',
    name: 'Qwen3.8-27B + DFlash2 · 极速 32K',
    desc: '上下文 32768、KV f16、批 4096、Draft N=12 — 追求最高解码速度',
    hint: STRIX_HALO_HINT,
    changes: {
      'model.ctx_size': 32768,
      'model.n_predict': 8192,
      'model.batch_size': 4096,
      'server.parallel': 8,
      'compute.threads': 16,
      'memory.ngl': '999',
      'model.flash_attn': 'on',
      'memory.cache_type_k': 'f16',
      'memory.cache_type_v': 'f16',
      'speculative.spec_type': 'draft-dflash',
      'speculative.draft_n_max': 12,
      'speculative.draft_ngl': 'all',
    },
  },
] as const;

// ---------------------------------------------------------------------------
// 默认配置 — 参数部分完全由元数据表派生（除 5 个启动器必填项外全部 inherit），
//   本文件只补充不参与命令行的应用层字段
//   注意：与 v1 不同，全新安装默认只听 127.0.0.1，且模型目录留空待用户选择
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Config = deepFreeze({
  ...(structuredClone(DEFAULT_PARAMS) as Config),
  rpc: { server: { enabled: false, host: '127.0.0.1', port: 50052 }, endpoints: [] },
  proxy: { enabled: true, url: '' },
  presets: structuredClone(DEFAULT_PRESETS) as ConfigPreset[],
  config_version: CONFIG_VERSION,
});

// 冻结共享默认值：任何调用方拿到的都必须是深拷贝副本（见 config.ts defaultConfig），
// 原地误改 DEFAULT_CONFIG 会污染整个进程生命周期内的所有后续读取
deepFreeze(DEFAULT_PRESETS);
