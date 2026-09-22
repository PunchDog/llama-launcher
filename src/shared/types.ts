// =============================================================================
// Shared Type System — 所有 interface 和 type 必须完整导出
// =============================================================================

// ---------------------------------------------------------------------------
// GPU 后端类型
// ---------------------------------------------------------------------------

export type GpuBackend = 'vulkan' | 'rocm';

// ---------------------------------------------------------------------------
// 三态（tri-state）参数值
//   null = inherit：不写进命令行，由 llama-server 自己决定默认值
//   非 null = explicit：写进命令行
//   数组型参数用 [] 表示 inherit
// ---------------------------------------------------------------------------

export type Tri<T> = T | null;

// ---------------------------------------------------------------------------
// Config 相关
//   v2：全部 llama-server 参数集中在 ParamsConfig，按参数域分组，值一律三态；
//   字段路径与 src/shared/params/groups/*.ts 里的 ParamDef.key 一一对应，
//   新增/改名只能改元数据表，本文件同步维护。
// ---------------------------------------------------------------------------

/** 服务与网络 — 对应 llama-server 的 host/port/endpoint/路由类参数 */
export interface ServerParams {
  host: Tri<string>;
  port: Tri<number>;
  timeout: Tri<number>;
  api_key: Tri<string>;
  api_key_file: Tri<string>;
  reuse_port: Tri<boolean>;
  api_prefix: Tri<string>;
  static_path: Tri<string>;
  media_path: Tri<string>;
  cors_origins: Tri<string>;
  metrics: Tri<boolean>;
  props: Tri<boolean>;
  slots: Tri<boolean>;
  slot_save_path: Tri<string>;
  slot_prompt_similarity: Tri<number>;
  models_dir: Tri<string>;
  models_max: Tri<number>;
  models_autoload: Tri<boolean>;
  alias: Tri<string>;
  tags: Tri<string>;
  parallel: Tri<number>;
  cont_batching: Tri<boolean>;
  warmup: Tri<boolean>;
  sleep_idle_seconds: Tri<number>;
  embedding: Tri<boolean>;
  rerank: Tri<boolean>;
  pooling: Tri<string>;
  embd_normalize: Tri<number>;
  webui: Tri<boolean>;
}

/** 模型加载 — 模型文件、上下文规模、位置编码扩展、对话模板 */
export interface ModelParams {
  model: Tri<string>;
  ctx_size: Tri<number>;
  batch_size: Tri<number>;
  ubatch_size: Tri<number>;
  n_predict: Tri<number>;
  keep: Tri<number>;
  load_mode: Tri<string>;
  lazy_mode: Tri<string>;
  flash_attn: Tri<string>;
  rope_scaling: Tri<string>;
  rope_scale: Tri<number>;
  rope_freq_base: Tri<number>;
  rope_freq_scale: Tri<number>;
  yarn_orig_ctx: Tri<number>;
  yarn_ext_factor: Tri<number>;
  yarn_attn_factor: Tri<number>;
  yarn_beta_slow: Tri<number>;
  yarn_beta_fast: Tri<number>;
  chat_template: Tri<string>;
  chat_template_file: Tri<string>;
  jinja: Tri<boolean>;
  special: Tri<boolean>;
  spm_infill: Tri<boolean>;
}

/** 显存与缓存 — 层卸载、KV cache、prompt cache、--fit 自适应 */
export interface MemoryParams {
  ngl: Tri<string>;
  device: Tri<string>;
  split_mode: Tri<string>;
  tensor_split: Tri<string>;
  main_gpu: Tri<number>;
  cache_type_k: Tri<string>;
  cache_type_v: Tri<string>;
  kv_unified: Tri<boolean>;
  kv_unified_per_slot: Tri<number>;
  kv_offload: Tri<boolean>;
  swa_full: Tri<boolean>;
  cache_ram: Tri<number>;
  cache_idle_slots: Tri<boolean>;
  cache_prompt: Tri<boolean>;
  cache_reuse: Tri<number>;
  context_shift: Tri<boolean>;
  fit: Tri<string>;
  fit_target: Tri<number>;
  fit_ctx: Tri<number>;
  ctx_checkpoints: Tri<number>;
  checkpoint_min_step: Tri<number>;
}

/** 计算与线程 — CPU 线程/亲和性/NUMA、MoE 权重驻留 */
export interface ComputeParams {
  threads: Tri<number>;
  threads_batch: Tri<number>;
  threads_http: Tri<number>;
  numa: Tri<string>;
  cpu_mask: Tri<string>;
  cpu_range: Tri<string>;
  cpu_strict: Tri<number>;
  prio: Tri<number>;
  poll: Tri<number>;
  cpu_moe: Tri<boolean>;
  n_cpu_moe: Tri<number>;
  n_cpu_ffn: Tri<number>;
  repack: Tri<boolean>;
  op_offload: Tri<boolean>;
  no_host: Tri<boolean>;
  perf: Tri<boolean>;
}

/** 采样 — 生成随机性与重复惩罚 */
export interface SamplingParams {
  temperature: Tri<number>;
  top_k: Tri<number>;
  top_p: Tri<number>;
  min_p: Tri<number>;
  top_n_sigma: Tri<number>;
  typical_p: Tri<number>;
  xtc_probability: Tri<number>;
  xtc_threshold: Tri<number>;
  dynatemp_range: Tri<number>;
  dynatemp_exponent: Tri<number>;
  mirostat: Tri<number>;
  mirostat_lr: Tri<number>;
  mirostat_ent: Tri<number>;
  adaptive_target: Tri<number>;
  adaptive_decay: Tri<number>;
  repeat_penalty: Tri<number>;
  repeat_last_n: Tri<number>;
  presence_penalty: Tri<number>;
  frequency_penalty: Tri<number>;
  dry_multiplier: Tri<number>;
  dry_base: Tri<number>;
  dry_allowed_length: Tri<number>;
  dry_penalty_last_n: Tri<number>;
  dry_sequence_breaker: Tri<string[]>;
  samplers: Tri<string>;
  seed: Tri<number>;
  ignore_eos: Tri<boolean>;
  logit_bias: Tri<string[]>;
  grammar: Tri<string>;
  grammar_file: Tri<string>;
  json_schema: Tri<string>;
  json_schema_file: Tri<string>;
}

/** 投机解码 — --spec-type 分支及其调优 */
export interface SpeculativeParams {
  spec_type: Tri<string>;
  draft_n_max: Tri<number>;
  draft_n_min: Tri<number>;
  draft_model: Tri<string>;
  draft_ngl: Tri<string>;
  draft_type_k: Tri<string>;
  draft_type_v: Tri<string>;
  draft_p_split: Tri<number>;
  draft_p_min: Tri<number>;
  draft_backend_sampling: Tri<boolean>;
  ngram_mod_n_min: Tri<number>;
  ngram_mod_n_max: Tri<number>;
  ngram_mod_n_match: Tri<number>;
  ngram_simple_size_n: Tri<number>;
  ngram_simple_size_m: Tri<number>;
  ngram_simple_min_hits: Tri<number>;
  ngram_map_k_size_n: Tri<number>;
  ngram_map_k_size_m: Tri<number>;
  ngram_map_k_min_hits: Tri<number>;
  ngram_map_k4v_size_n: Tri<number>;
  ngram_map_k4v_size_m: Tri<number>;
  ngram_map_k4v_min_hits: Tri<number>;
  lookup_cache_static: Tri<string>;
  lookup_cache_dynamic: Tri<string>;
}

/** 推理/思考链 — reasoning 系参数与模板附加参数 */
export interface ReasoningParams {
  reasoning: Tri<string>;
  reasoning_format: Tri<string>;
  reasoning_effort: Tri<string>;
  reasoning_budget: Tri<number>;
  reasoning_budget_message: Tri<string>;
  reasoning_preserve: Tri<boolean>;
  chat_template_kwargs: Tri<string>;
  prefill_assistant: Tri<boolean>;
  skip_chat_parsing: Tri<boolean>;
}

/** 多模态 — mmproj 与图像/视频输入 */
export interface MultimodalParams {
  mmproj: Tri<string>;
  mmproj_url: Tri<string>;
  mmproj_auto: Tri<boolean>;
  mmproj_offload: Tri<boolean>;
  mmproj_device: Tri<string>;
  image_min_tokens: Tri<number>;
  image_max_tokens: Tri<number>;
  mtmd_batch_max_tokens: Tri<number>;
  video_fps: Tri<number>;
  video_timestamp_interval: Tri<number>;
  video_ffmpeg_dir: Tri<string>;
}

/** LoRA 与控制向量 */
export interface LoraParams {
  lora: Tri<string[]>;
  lora_scaled: Tri<string>;
  control_vector: Tri<string[]>;
  control_vector_scaled: Tri<string>;
  control_vector_layer_range: Tri<string[]>;
  lora_init_without_apply: Tri<boolean>;
}

/** RPC 客户端端点（rpc-server 子进程本身属应用层配置，见 RpcServerAppConfig） */
export interface RpcParams {
  endpoints: Tri<string[]>;
}

/** 日志、调试与高级覆写 */
export interface AdvancedParams {
  verbose: Tri<boolean>;
  log_disable: Tri<boolean>;
  log_file: Tri<string>;
  log_verbosity: Tri<number>;
  log_prefix: Tri<boolean>;
  log_timestamps: Tri<boolean>;
  log_jsonl: Tri<boolean>;
  log_colors: Tri<string>;
  check_tensors: Tri<boolean>;
  offline: Tri<boolean>;
  escape: Tri<boolean>;
  override_kv: Tri<string[]>;
  override_tensor: Tri<string[]>;
  /** 内置工具名列表（csv），all 表示开放全部内置工具 */
  tools: Tri<string[]>;
}

/** 逃生口 — 原样追加到命令行末尾的裸参数（不校验、最后发射） */
export interface ExtraParams {
  args: Tri<string[]>;
}

/** 所有会发射到 llama-server 命令行的参数 */
export interface ParamsConfig {
  server: ServerParams;
  model: ModelParams;
  memory: MemoryParams;
  compute: ComputeParams;
  sampling: SamplingParams;
  speculative: SpeculativeParams;
  reasoning: ReasoningParams;
  multimodal: MultimodalParams;
  lora: LoraParams;
  rpc: RpcParams;
  advanced: AdvancedParams;
  extra: ExtraParams;
}

/** 本地 ggml-rpc-server 子进程 — 应用层，不发射为 llama-server 参数 */
export interface RpcServerAppConfig {
  enabled: boolean;
  host: string;
  port: number;
}

/** 本地 ggml-rpc-server 子进程 + RPC 客户端端点列表 */
export interface RpcConfig extends RpcParams {
  server: RpcServerAppConfig;
}

export interface Config extends Omit<ParamsConfig, 'rpc'> {
  rpc: RpcConfig;
  /** 启动器自身的网络代理设置（不参与命令行） */
  proxy: { enabled: boolean; url: string };
  /** 参数预设列表 — 存于 config.json，可手动编辑增删 */
  presets: ConfigPreset[];
  /** v1 迁移时未被参数表认领的旧字段：只保留不发射，供用户自查后删除 */
  unknown_v1?: Record<string, unknown>;
  /** 配置结构版本号（config.ts 阶梯式迁移的判定依据），由主进程维护 */
  config_version?: number;
}

/** Config 里会由元数据渲染的点路径联合类型 */
export type ConfigKey = import('./params/schema').ParamKeyOf<ParamsConfig>;

// ---------------------------------------------------------------------------
// 参数预设 — 一键套用一组参数（changes 的键为 ParamDef.key 点路径）
// ---------------------------------------------------------------------------

export interface ConfigPreset {
  id: string;
  name: string;
  desc: string;
  /** 适用环境 / 后端 / BIOS 等提示文案 */
  hint: string;
  /** 点路径 → 显式值；未列出的参数保持原值 */
  changes: Partial<Record<ConfigKey, number | string | boolean | string[]>>;
}

// ---------------------------------------------------------------------------
// 配置校验问题 — validateConfig 输出，启动前阻断 / UI 定位字段用
// ---------------------------------------------------------------------------

export interface ConfigIssue {
  /** 点分隔字段路径，如 'server.models_dir' / 'model.ctx_size' */
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// ---------------------------------------------------------------------------
// IPC 响应封套 — 主进程所有 handle 统一返回 {ok,data|error}，
//   渲染层 api.ts 解包后在失败时 throw，避免错误语义散落在各通道
// ---------------------------------------------------------------------------

export type IpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

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
  downloadSpeed: number;  // KB/s
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
  /** 保存后返回主进程归一化的配置，渲染层以它为准（未知键/类型不符的字段会被清掉） */
  'config:save': { request: Config; response: Config };
  'config:update': { request: { key: string; value: unknown }; response: Config };
  'config:validate': { request: Config; response: ConfigIssue[] };
  'server:start': { response: void };
  'server:stop': { response: void };
  'server:restart': { response: void };
  'server:get-state': { response: ServerState };
  'server:get-logs': { response: string[] };
  'server:get-command': { response: string };
  'server:preview-command': { request: Config; response: string };
  'server:on-log': { response: string };
  'server:state-changed': { response: ServerState };
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
  // ----- 主进程推送 -----
  'updater:progress': { response: UpdaterState };
  'model:progress': { response: ModelDownloadState };
  // ----- 系统对话框 -----
  'dialog:open-folder': { response: string | null };
  'dialog:open-file': { response: string | null };
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
