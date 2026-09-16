// =============================================================================
// Shared Type System — 所有 interface 和 type 必须完整导出
// =============================================================================

// ---------------------------------------------------------------------------
// GPU 后端类型
// ---------------------------------------------------------------------------

export type GpuBackend = 'vulkan' | 'rocm';

// ---------------------------------------------------------------------------
// Config 相关（完全映射 Go 版 config.go，JSON tag 使用 snake_case）
// ---------------------------------------------------------------------------

export interface RPCServerConfig {
  enabled: boolean;
  host: string;
  port: number;
  workers: number;
  timeout: number;
}

export interface OptionalConfig {
  model: string;
  cont_batching: boolean;
  log_format: string;
  log_disable: boolean;
  verbose: boolean;
  mlock: boolean;
  no_mmap: boolean;
  embedding: boolean;
  pooling: string;
  rope_scaling: string;
  rope_freq_base: number;
  rope_freq_scale: number;
  numa: boolean;
  low_vram: boolean;
  tfs_z: number;
  top_k: number;
  top_p: number;
  min_p: number;
  temperature: number;
  repeat_penalty: number;
  repeat_last_n: number;
  presence_penalty: number;
  frequency_penalty: number;
  jinja: boolean;
  chatTemplateKwargs: string;
}

export interface Config {
  models_dir: string;
  models_max: number;
  timeout: number;
  host: string;
  port: number;
  api_key: string;
  ngl: number;
  flash_attn: string;
  cache_type_k: string;
  cache_type_v: string;
  threads: number;
  batch_size: number;
  ctx_size: number;
  n_predict: number;
  parallel: number;
  metrics: boolean;
  tensor_batch: number;
  kv_unified: boolean;
  mtp: number;
  /** 投机解码类型：none / draft-* / ngram-*（见 constants.ts SPEC_TYPES） */
  spec_type: string;
  /** 草稿模型 GGUF 文件路径（draft-simple/eagle3/dflash/dspark 需要；DFlash2 走 draft-dflash） */
  spec_draft_model: string;
  /** 草稿模型 GPU 层数：'auto' | 'all' | 数字字符串（llama.cpp 默认 auto） */
  spec_draft_ngl: string;
  proxy_enabled: boolean;
  proxy_url: string;
  optional: OptionalConfig;
  rpc_server: RPCServerConfig;
  /** 参数预设列表 — 存于 config.json，可手动编辑增删 */
  presets: ConfigPreset[];
}

// ---------------------------------------------------------------------------
// 参数预设 — 一键套用一组优化参数（存于 config.json 顶层 presets 字段）
// ---------------------------------------------------------------------------

export interface ConfigPreset {
  id: string;
  name: string;
  desc: string;
  /** 适用环境 / 后端 / BIOS 等提示文案 */
  hint: string;
  /** 覆盖的顶层配置字段（不含 presets 自身与用户私有项） */
  config: Partial<Omit<Config, 'presets'>>;
  /** 覆盖的 optional 子字段 */
  optional?: Partial<OptionalConfig>;
}

// ---------------------------------------------------------------------------
// Server 进程状态
// ---------------------------------------------------------------------------

export enum ServerState {
  Stopped = 0,
  Starting = 1,
  Running = 2,
  Stopping = 3,
}

export const ServerStateLabel: Record<ServerState, string> = {
  [ServerState.Stopped]: '未运行',
  [ServerState.Starting]: '启动中...',
  [ServerState.Running]: '运行中',
  [ServerState.Stopping]: '停止中...',
};

// ---------------------------------------------------------------------------
// Core 更新器相关
// ---------------------------------------------------------------------------

export interface ReleaseInfo {
  tag_name: string;
  assets: Asset[];
  /** release 说明文本 — 用于兜底解析 nightly 构建 tag */
  body?: string;
  prerelease?: boolean;
}

export interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface UpdaterState {
  progress: number;
  status: string;
  error: string;
  latestTag: string;
  /** 正式版 release tag（如 "v0.4.1"）；latestTag 为 nightly 构建 tag（如 "b10964"） */
  latestReleaseTag: string;
  downloadURL: string;
  assetName: string;
  downloadedBytes: number;
  downloadSize: number;
  downloadSpeed: number;  // KB/s
  isDownloading: boolean;
  selectedOS: string;
  selectedBackend: string;
}

// ---------------------------------------------------------------------------
// ModelScope 模型下载相关
// ---------------------------------------------------------------------------

/** Python / modelscope 环境检测结果（用于 HTTPS 直链下载失败后的 Python 工具回退） */
export interface ModelScopeEnvState {
  pythonInstalled: boolean;
  pythonPath: string;
  pythonVersion: string;
  modelscopeInstalled: boolean;
  modelscopeVersion: string;
}

/** 搜索 API 返回的一个模型条目（模型 ID 用于后续下载） */
export interface ModelInfo {
  id: string;          // 如 "Qwen/Qwen2.5-7B-Instruct"
  downloads?: number;
  task?: string;
  summary?: string;
}

/** 模型仓库内单个文件（repo/files API 返回） */
export interface ModelFile {
  name: string;
  path: string;
  size: number;
  type: string;        // 'file' | 'tree'
}

/** 模型下载器状态 — 进度/日志由主进程通过 EventEmitter 推送给渲染进程 */
export interface ModelDownloadState {
  progress: number;
  status: string;
  error: string;
  isDownloading: boolean;
  mode: 'http' | 'cli' | '';  // 当前下载方式：HTTPS 直链 / Python CLI / 空闲
  modelId: string;
  localDir: string;
  currentFile: string;
  downloadedBytes: number;
  downloadSize: number;
  /** HTTPS 直链下载失败，提示改用 Python 工具 */
  httpFailed: boolean;
  files: ModelFile[];
  selectedFiles: string[];
}

// ---------------------------------------------------------------------------
// IPC 通道类型映射（使用泛型确保类型安全）
//   - TChannel extends keyof IpcChannelMap → 编译时校验通道名
//   - 只读映射表，避免运行时膨胀
// ---------------------------------------------------------------------------

export interface IpcChannelMap {
  'config:load': { response: Config };
  'config:save': { request: Config; response: void };
  'config:update': { request: { key: string; value: unknown }; response: void };
  'server:start': { request: { args: string[] }; response: void };
  'server:stop': { response: void };
  'server:get-state': { response: ServerState };
  'server:get-logs': { response: string[] };
  'server:get-command': { response: string };
  'server:preview-command': { request: Config; response: string };
  'server:on-log': { response: string };
  'updater:check-latest': { response: { tag: string; releaseTag: string; size: number } };
  'updater:check-core-exists': { response: boolean };
  'updater:get-local-version': { response: string };
  'updater:download-and-extract': { response: void };
  'updater:extract-specific': { request: { filename: string }; response: void };
  'updater:list-downloaded-files': { response: string[] };
  'updater:get-progress': { response: UpdaterState };
  'updater:set-proxy': { request: { proxy: string }; response: void };
  'updater:set-backend': { request: { backend: string }; response: UpdaterState };
  // ----- ModelScope 模型下载 -----
  'model:check-env': { response: ModelScopeEnvState };
  'model:install-modelscope': { response: void };
  'model:search-models': { request: { keyword: string }; response: ModelInfo[] };
  'model:list-files': { request: { modelId: string }; response: ModelFile[] };
  'model:download': { request: { modelId: string; localDir: string; files?: string[]; mode: 'http' | 'cli' }; response: void };
  'model:get-progress': { response: ModelDownloadState };
  'model:set-proxy': { request: { proxy: string }; response: void };
  'model:cancel': { response: void };
}

// ---------------------------------------------------------------------------
// 便捷泛型工具类型
// ---------------------------------------------------------------------------

/** 提取指定通道的请求参数类型 */
export type IpcRequest<T extends keyof IpcChannelMap> =
  IpcChannelMap[T] extends { request: infer R } ? R : never;

/** 提取指定通道的响应类型 */
export type IpcResponse<T extends keyof IpcChannelMap> =
  IpcChannelMap[T] extends { response: infer R } ? R : never;

/** 所有 IPC 通道名称联合类型 */
export type IpcChannelName = keyof IpcChannelMap;
