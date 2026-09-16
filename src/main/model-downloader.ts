import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  ModelScopeEnvState,
  ModelInfo,
  ModelFile,
  ModelDownloadState,
} from '../shared/types';

// =============================================================================
// ModelDownloader — ModelScope 模型下载（HTTPS 直链优先，Python 工具回退）
//   继承自 EventEmitter：通过 emit('log', line) 把进度/状态推给主进程转发到日志区
// =============================================================================

const MODELSCOPE_API_BASE = 'https://modelscope.cn/api/v1';

function initialModelState(): ModelDownloadState {
  return {
    progress: 0,
    status: '空闲',
    error: '',
    isDownloading: false,
    mode: '',
    modelId: '',
    localDir: '',
    currentFile: '',
    downloadedBytes: 0,
    downloadSize: 0,
    httpFailed: false,
    files: [],
    selectedFiles: [],
  };
}

export class ModelDownloader extends EventEmitter {
  state: ModelDownloadState = initialModelState();
  private _env: ModelScopeEnvState = {
    pythonInstalled: false,
    pythonPath: '',
    pythonVersion: '',
    modelscopeInstalled: false,
    modelscopeVersion: '',
  };
  private _pythonPath = '';
  private _abort: AbortController | null = null;
  private _child: ChildProcess | null = null;
  proxyUrl = '';

  // ----- 状态辅助 -----

  getState(): ModelDownloadState {
    return { ...this.state };
  }

  getEnv(): ModelScopeEnvState {
    return { ...this._env };
  }

  setProxy(url: string): void {
    this.proxyUrl = url;
  }

  private setStatus(s: string): void {
    const changed = s !== this.state.status;
    this.state.status = s;
    if (changed && s) this.emit('log', s);
  }

  private setError(e: string): void {
    this.state.error = e;
    this.state.status = `❌ ${e}`;
    this.emit('log', `❌ ${e}`);
  }

  private proxyConfig() {
    if (!this.proxyUrl) return false;
    try {
      const u = new URL(this.proxyUrl);
      return {
        host: u.hostname,
        port: parseInt(u.port, 10) || 7890,
        protocol: u.protocol.replace(':', ''),
      };
    } catch {
      return false;
    }
  }

  private cliEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.proxyUrl) {
      env.HTTP_PROXY = this.proxyUrl;
      env.HTTPS_PROXY = this.proxyUrl;
      env.MODELSCOPE_HTTP_PROXY = this.proxyUrl;
      env.MODELSCOPE_HTTPS_PROXY = this.proxyUrl;
    }
    return env;
  }

  /** 把路径按 '/' 分段编码，保留 owner/name 与子目录的层级结构 */
  private segEncode(p: string): string {
    return p
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
  }

  // ----- 环境检测 -----

  private findPython(): { path: string; version: string } | null {
    for (const cmd of ['python', 'python3']) {
      try {
        const r = spawnSync(cmd, ['--version'], {
          encoding: 'utf-8',
          windowsHide: true,
          timeout: 10000,
        });
        const ver = (r.stdout || r.stderr || '').trim();
        if (r.status === 0 && ver) return { path: cmd, version: ver };
      } catch {
        // 尝试下一个候选命令
      }
    }
    return null;
  }

  async checkEnv(): Promise<ModelScopeEnvState> {
    const env: ModelScopeEnvState = {
      pythonInstalled: false,
      pythonPath: '',
      pythonVersion: '',
      modelscopeInstalled: false,
      modelscopeVersion: '',
    };
    const py = this.findPython();
    if (!py) {
      this._env = env;
      this.emit('log', '[modelscope] 未检测到 Python，Python 工具回退不可用');
      return env;
    }
    env.pythonInstalled = true;
    env.pythonPath = py.path;
    env.pythonVersion = py.version;
    this._pythonPath = py.path;

    try {
      const r = spawnSync(
        py.path,
        ['-c', 'import modelscope; print(modelscope.__version__)'],
        { encoding: 'utf-8', windowsHide: true, timeout: 20000 },
      );
      const ver = (r.stdout || '').trim();
      if (r.status === 0 && ver) {
        env.modelscopeInstalled = true;
        env.modelscopeVersion = ver;
      }
    } catch {
      env.modelscopeInstalled = false;
    }

    this._env = env;
    this.emit('log', `[modelscope] Python: ${py.version} @ ${py.path}`);
    this.emit('log', env.modelscopeInstalled
      ? `[modelscope] modelscope: ${env.modelscopeVersion}`
      : '[modelscope] modelscope 未安装');
    return env;
  }

  /** 安装 modelscope（仅 Python 回退路径需要） */
  async installModelscope(): Promise<void> {
    if (!this._pythonPath) {
      const py = this.findPython();
      if (!py) throw new Error('未检测到 Python，无法安装 modelscope');
      this._pythonPath = py.path;
    }
    this.setStatus('正在安装 modelscope...');
    const args = ['-m', 'pip', 'install', '-U', 'modelscope'];
    if (this.proxyUrl) args.push('--proxy', this.proxyUrl);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this._pythonPath, args, {
        windowsHide: true,
        env: this.cliEnv(),
      });
      this._child = child;
      child.stdout.on('data', (d) => this.emit('log', d.toString().trim()));
      child.stderr.on('data', (d) => this.emit('log', d.toString().trim()));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        this._child = null;
        if (code === 0) {
          this.setStatus('✅ modelscope 安装完成');
          resolve();
        } else {
          reject(new Error(`pip 退出码 ${code}`));
        }
      });
    });

    await this.checkEnv();
  }

  // ----- 搜索模型名列表 -----

  /** 将 API 返回的原始条目统一为 ModelInfo（不同接口字段名有差异，防御性解析） */
  private toModelInfo(m: Record<string, unknown>): ModelInfo {
    let id = '';
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
  private extractModelList(data: unknown): Record<string, unknown>[] {
    const d = (data ?? {}) as Record<string, unknown>;
    const model = d.Model as Record<string, unknown> | undefined;
    const candidates = [model?.Models, d.Models, d.models, d];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c as Record<string, unknown>[];
    }
    return [];
  }

  /** 提取查询关键词的有效 token（长度≥3），用于结果相关性过滤 */
  private queryTokens(kw: string): string[] {
    return kw
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
  }

  /** 相关性校验：结果 id/摘要至少包含一个查询 token，过滤无匹配时返回的热门推荐噪音 */
  private isRelevant(m: ModelInfo, tokens: string[], rawLower: string): boolean {
    const hay = `${m.id} ${m.summary ?? ''}`.toLowerCase();
    return hay.includes(rawLower) || tokens.some((t) => hay.includes(t));
  }

  /**
   * 搜索模型。
   * 注意：站点搜索接口（/dolphin/models）的 Query 参数实测被服务器忽略，
   * 无论关键词是什么都返回同一批热门模型，因此不采用。
   * 实测可靠的两种途径：
   *   0. 输入含 "/"：
   *      a. 按完整模型 ID 精确查询详情（GET /models/{id}）
   *      b. 失败则按组织列出模型（PUT /models/ {Path: org}）+ 客户端按名称过滤
   *   1. 输入视为组织名（如 Qwen / unsloth / deepseek-ai）→ 列出该组织全部模型
   */
  async searchModels(keyword: string): Promise<ModelInfo[]> {
    const raw = keyword.trim();
    if (!raw) {
      throw new Error('请输入组织名（如 Qwen / unsloth / deepseek-ai）或完整模型 ID（如 Qwen/Qwen2.5-7B-Instruct）');
    }
    // 用户可能直接粘贴模型文件名（如 xxx-Q4_K_M.gguf），去掉扩展名再搜索
    const kw = raw.replace(/\.(gguf|safetensors|bin|pth|onnx)$/i, '');
    this.setStatus(`搜索模型: ${kw}`);

    // 策略 0：完整模型 ID
    if (kw.includes('/')) {
      // 0a. 精确查询
      try {
        const resp = await axios.get(
          `${MODELSCOPE_API_BASE}/models/${this.segEncode(kw)}`,
          { timeout: 30000, proxy: this.proxyConfig() },
        );
        const data = (resp.data?.Data ?? resp.data) as Record<string, unknown>;
        const info = this.toModelInfo(data);
        if (info.id) {
          this.setStatus('找到 1 个模型');
          return [info];
        }
      } catch {
        // ID 不存在，转 0b 按组织模糊匹配
      }

      // 0b. 按组织列出 + 按名称过滤
      const [org, ...restParts] = kw.split('/');
      const rest = restParts.join('/');
      try {
        const list = await this.listByOwner(org);
        const tokens = this.queryTokens(rest);
        const filtered = tokens.length
          ? list.filter((m) => this.isRelevant(m, tokens, rest.toLowerCase()))
          : list;
        if (filtered.length) {
          this.setStatus(`找到 ${filtered.length} 个模型`);
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
          { headers, timeout: 30000, proxy: this.proxyConfig() },
        );
        const data = resp.data?.Data;
        const items = this.extractModelList(data)
          .map((m) => this.toModelInfo(m))
          .filter((x) => x.id);
        all.push(...items);
        const total = this.extractTotal(data);
        if (items.length < pageSize || (total > 0 && all.length >= total)) break;
      }
      const tokens = this.queryTokens(kw);
      const list = all
        .filter((x) => this.isRelevant(x, tokens, kw.toLowerCase()))
        .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
      if (list.length) {
        this.setStatus(`找到 ${list.length} 个模型`);
        return list;
      }
    } catch {
      // 转策略 2
    }

    // 策略 2：输入视为组织名（如 Qwen / unsloth / deepseek-ai）
    try {
      const list = await this.listByOwner(kw);
      if (list.length) {
        const sorted = [...list].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
        this.setStatus(`找到 ${sorted.length} 个模型（${kw} 组织）`);
        return sorted;
      }
    } catch {
      // 落到底部报错
    }

    throw new Error(
      `未找到组织「${kw}」：请输入组织名（如 Qwen / unsloth / deepseek-ai）或完整模型 ID（如 Qwen/Qwen2.5-7B-Instruct）`,
    );
  }

  /** 从响应 Data 中提取总数字段（组织列表接口返回 TotalCount） */
  private extractTotal(data: unknown): number {
    const d = (data ?? {}) as Record<string, unknown>;
    const model = d.Model as Record<string, unknown> | undefined;
    const t = d.TotalCount ?? model?.TotalCount;
    return typeof t === 'number' ? t : 0;
  }

  /** 去重（按模型 ID） */
  private dedupe(list: ModelInfo[]): ModelInfo[] {
    const seen = new Set<string>();
    return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }

  /**
   * 按组织/所有者列出全部模型（PUT /models/ {Path}，官方 SDK 用法，实测真实过滤）。
   * 分页拉取直至取满 TotalCount，不做条数截断（上限 40 页 × 50 条作安全阀）。
   */
  private async listByOwner(owner: string): Promise<ModelInfo[]> {
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
        { headers, timeout: 30000, proxy: this.proxyConfig() },
      );
      const data = resp.data?.Data;
      const items = this.extractModelList(data)
        .map((m) => this.toModelInfo(m))
        .filter((x) => x.id);
      all.push(...items);
      const total = this.extractTotal(data);
      if (items.length < pageSize || (total > 0 && all.length >= total)) break;
    }
    return this.dedupe(all);
  }

  // ----- 获取模型仓库文件列表 -----

  async listFiles(modelId: string): Promise<ModelFile[]> {
    this.setStatus(`获取文件列表: ${modelId}`);
    const url = `${MODELSCOPE_API_BASE}/models/${this.segEncode(modelId)}/repo/files`;
    const resp = await axios.get(url, {
      params: { Revision: 'master', Root: '.' },
      timeout: 30000,
      proxy: this.proxyConfig(),
    });
    const data = resp.data?.Data as Record<string, unknown> | undefined;
    const raw: unknown[] = (data?.Files as unknown[]) ?? (Array.isArray(data) ? data : []);
    const files: ModelFile[] = (raw as Record<string, unknown>[])
      .filter((f) => f.Type === 'blob' || f.Type === 'file')
      .map((f) => ({
        name: String(f.Name ?? ''),
        path: String(f.Path ?? ''),
        size: typeof f.Size === 'number' ? f.Size : 0,
        type: String(f.Type ?? 'blob'),
      }));
    this.state.files = files;
    this.state.selectedFiles = [];
    this.setStatus(`共 ${files.length} 个文件`);
    return files;
  }

  // ----- 下载入口（按 mode 分发） -----

  async download(req: {
    modelId: string;
    localDir: string;
    files?: string[];
    mode: 'http' | 'cli';
  }): Promise<void> {
    if (this.state.isDownloading) throw new Error('正在下载中，请等待');
    this._abort = new AbortController();

    try {
      if (req.mode === 'cli') {
        await this.downloadCli(req.modelId, req.localDir, req.files);
      } else {
        try {
          await this.downloadHttpFiles(req.modelId, req.localDir, req.files ?? []);
        } catch (err) {
          this.state.httpFailed = true;
          const msg = err instanceof Error ? err.message : String(err);
          this.setError(`HTTPS 直链下载失败：${msg}`);
          throw err;
        }
      }
    } finally {
      this.state.isDownloading = false;
    }
  }

  /** HTTPS 直链下载（优先路径） */
  private async downloadHttpFiles(
    modelId: string,
    localDir: string,
    files: string[],
  ): Promise<void> {
    this.state.mode = 'http';
    this.state.isDownloading = true;
    this.state.error = '';
    this.state.httpFailed = false;
    this.state.progress = 0;
    this.state.downloadedBytes = 0;
    this.state.downloadSize = 0;
    this.state.modelId = modelId;
    this.state.localDir = localDir;

    const targets = files.length ? files : this.state.files.map((f) => f.path);
    if (targets.length === 0) {
      throw new Error('没有可下载的文件，请先获取文件列表并勾选');
    }

    const meta = new Map(this.state.files.map((f) => [f.path, f]));
    const totalAll = targets.reduce((s, p) => s + (meta.get(p)?.size || 0), 0);
    this.state.downloadSize = totalAll;
    let downloadedAll = 0;

    fs.mkdirSync(localDir, { recursive: true });

    for (let i = 0; i < targets.length; i++) {
      const rel = targets[i];
      this.state.currentFile = rel;
      this.setStatus(`[${i + 1}/${targets.length}] 下载: ${rel}`);
      const fileSize = meta.get(rel)?.size || 0;
      await this.downloadSingleFile(modelId, localDir, rel, fileSize, totalAll, (inc) => {
        downloadedAll += inc;
        this.state.downloadedBytes = downloadedAll;
        if (totalAll > 0) {
          this.state.progress = Math.min(100, (downloadedAll / totalAll) * 100);
        }
      });
    }

    this.state.progress = 100;
    this.setStatus(`✅ HTTPS 下载完成：共 ${targets.length} 个文件 → ${localDir}`);
  }

  private downloadSingleFile(
    modelId: string,
    localDir: string,
    rel: string,
    _fileSize: number,
    _totalAll: number,
    onChunk: (inc: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 官方 SDK 下载 URL：/api/v1/models/{model_id}/repo?Revision=&FilePath=
      const url =
        `${MODELSCOPE_API_BASE}/models/${this.segEncode(modelId)}` +
        `/repo?Revision=master&FilePath=${encodeURIComponent(rel)}`;
      const dest = path.join(localDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const writer = fs.createWriteStream(dest);

      axios
        .get(url, {
          responseType: 'stream',
          maxRedirects: 5,
          timeout: 0,
          signal: this._abort?.signal,
          proxy: this.proxyConfig(),
        })
        .then((resp) => {
          if (resp.status !== 200) {
            writer.close();
            reject(new Error(`下载 ${rel} 返回 ${resp.status}`));
            return;
          }
          resp.data.on('data', (chunk: Buffer) => onChunk(chunk.length));
          resp.data.on('error', (e: Error) => {
            writer.close();
            reject(e);
          });
          resp.data.pipe(writer);
          writer.on('finish', () => resolve());
          writer.on('error', (e: Error) => {
            writer.close();
            reject(e);
          });
        })
        .catch((err) => {
          writer.close();
          reject(err);
        });
    });
  }

  /** Python modelscope CLI 下载（回退路径） */
  private async downloadCli(
    modelId: string,
    localDir: string,
    files?: string[],
  ): Promise<void> {
    if (!this._pythonPath) {
      const py = this.findPython();
      if (!py) throw new Error('未检测到 Python，无法使用 modelscope CLI');
      this._pythonPath = py.path;
    }
    this.state.mode = 'cli';
    this.state.isDownloading = true;
    this.state.error = '';
    this.state.httpFailed = false;
    this.state.modelId = modelId;
    this.state.localDir = localDir;
    this.setStatus(`使用 ModelScope Python 工具下载: ${modelId}`);

    const args = ['-m', 'modelscope.cli.download', '--model', modelId, '--local_dir', localDir];
    if (files && files.length) {
      args.push('--include', files.join(' '));
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this._pythonPath, args, {
        windowsHide: true,
        env: this.cliEnv(),
      });
      this._child = child;
      child.stdout.on('data', (d) => this.handleCliOutput(d.toString()));
      child.stderr.on('data', (d) => this.handleCliOutput(d.toString()));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        this._child = null;
        if (code === 0) {
          this.state.progress = 100;
          this.setStatus(`✅ Python 工具下载完成 → ${localDir}`);
          resolve();
        } else {
          reject(new Error(`modelscope CLI 退出码 ${code}`));
        }
      });
    });
  }

  private handleCliOutput(text: string): void {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      this.emit('log', line);
      const m = line.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) {
        const p = parseFloat(m[1]);
        if (!Number.isNaN(p)) this.state.progress = Math.min(100, p);
      }
    }
  }

  // ----- 取消 -----

  cancel(): void {
    this._abort?.abort();
    if (this._child) {
      try {
        this._child.kill();
      } catch {
        // 进程可能已退出
      }
      this._child = null;
    }
    this.setStatus('已取消');
    this.state.isDownloading = false;
  }
}
