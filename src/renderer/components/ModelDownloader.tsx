import { useState, useEffect, useCallback } from 'react';
import { useModelDownloader } from '../hooks/useModelDownloader';
import { useConfig } from '../hooks/useConfig';
import { Section, TextInput, PathInput, Button } from './ui';
import { ModelFile } from '@/shared/types';

// =============================================================================
// ModelDownloader — 「模型下载」标签页
//   环境检测 / 下载路径 / 模型搜索 / 文件选择 / HTTPS 优先下载 + Python 回退
// =============================================================================

function formatSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatCount(n?: number): string {
  if (n === undefined) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function ModelDownloader() {
  const {
    state,
    env,
    models,
    files,
    error,
    installModelscope,
    searchModels,
    listFiles,
    download,
    cancel,
    setProxy,
  } = useModelDownloader();
  const { config } = useConfig();

  const [keyword, setKeyword] = useState('');
  const [modelId, setModelId] = useState('');
  const [localDir, setLocalDir] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

  // 默认下载路径取配置 models_dir
  useEffect(() => {
    if (config?.models_dir && !localDir) setLocalDir(config.models_dir);
  }, [config?.models_dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 同步代理设置到主进程下载器
  useEffect(() => {
    if (!config) return;
    const proxy = config.proxy_enabled ? config.proxy_url || 'http://127.0.0.1:7890' : '';
    setProxy(proxy);
  }, [config?.proxy_enabled, config?.proxy_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = useCallback(async () => {
    const folder = (await window.electronAPI.invoke('dialog:open-folder')) as string | null;
    if (folder) setLocalDir(folder);
  }, []);

  const handleSearch = useCallback(() => {
    searchModels(keyword.trim());
  }, [keyword, searchModels]);

  const handleSelectModel = useCallback(
    (id: string) => {
      setModelId(id);
      setSelectedFiles([]);
      listFiles(id);
    },
    [listFiles],
  );

  const handleListFiles = useCallback(() => {
    if (modelId) listFiles(modelId);
  }, [modelId, listFiles]);

  const toggleFile = useCallback((p: string) => {
    setSelectedFiles((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }, []);

  const handleDownloadHttp = useCallback(() => {
    if (!modelId || !localDir) return;
    download({ modelId, localDir, files: selectedFiles, mode: 'http' });
  }, [modelId, localDir, selectedFiles, download]);

  const handleUseCli = useCallback(async () => {
    if (!env?.modelscopeInstalled) {
      setInstalling(true);
      try {
        await installModelscope();
      } finally {
        setInstalling(false);
      }
    }
    if (!modelId || !localDir) return;
    download({ modelId, localDir, files: selectedFiles, mode: 'cli' });
  }, [env?.modelscopeInstalled, installModelscope, modelId, localDir, selectedFiles, download]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await installModelscope();
    } finally {
      setInstalling(false);
    }
  }, [installModelscope]);

  const isDownloading = state.isDownloading;
  const needInstall = env && (!env.pythonInstalled || !env.modelscopeInstalled);

  const renderFileRow = (f: ModelFile) => {
    const checked = selectedFiles.includes(f.path);
    return (
      <label
        key={f.path}
        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-gray-700/40 ${
          checked ? 'bg-blue-600/10' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleFile(f.path)}
          disabled={isDownloading}
          className="accent-blue-500 w-3.5 h-3.5 shrink-0"
        />
        <span className="text-xs text-gray-200 font-mono flex-1 min-w-0 truncate" title={f.path}>
          {f.name}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">{formatSize(f.size)}</span>
      </label>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {/* 区块一：环境状态 */}
        <Section title="运行环境" desc="HTTPS 直链下载无需环境；失败回退到 ModelScope Python 工具时需要">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-400">Python</span>
              <span className="text-xs font-mono text-right flex-1 min-w-0 truncate">
                {env ? (
                  env.pythonInstalled ? (
                    <span className="text-emerald-400">{env.pythonVersion}</span>
                  ) : (
                    <span className="text-red-400">未安装</span>
                  )
                ) : (
                  '检测中...'
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-400">ModelScope</span>
              <span className="text-xs font-mono text-right flex-1 min-w-0 truncate">
                {env ? (
                  env.modelscopeInstalled ? (
                    <span className="text-emerald-400">{env.modelscopeVersion}</span>
                  ) : (
                    <span className="text-red-400">未安装</span>
                  )
                ) : (
                  '检测中...'
                )}
              </span>
            </div>
            {needInstall && (
              <Button variant="primary" onClick={handleInstall} disabled={installing || !env?.pythonInstalled} className="w-full">
                {installing ? '安装中...' : '安装 ModelScope'}
              </Button>
            )}
            {env && !env.pythonInstalled && (
              <p className="text-[11px] text-red-400">未检测到 Python，请先安装 Python 3 后再安装 ModelScope。</p>
            )}
          </div>
        </Section>

        {/* 区块二：下载路径 */}
        <Section title="下载路径" desc="模型文件保存目录，默认使用配置中的 models_dir">
          <PathInput value={localDir} onChange={setLocalDir} onPick={pickFolder} placeholder="未选择" title={localDir} />
        </Section>

        {/* 区块三：模型搜索 */}
        <Section title="模型搜索" desc="支持关键词（如 qwen3.8 / glm）、组织名（如 Qwen / unsloth）或完整模型 ID（如 unsloth/Qwen3.8-27B-GGUF）；GGUF 文件名自动去扩展名处理">
          <div className="flex gap-2 mb-2">
            <TextInput value={keyword} onChange={setKeyword} placeholder="关键词 / 组织名 / 完整模型 ID" onBlur={handleSearch} />
            <Button variant="primary" onClick={handleSearch} disabled={isDownloading}>
              获取模型列表
            </Button>
          </div>
          {models.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700/60">
              {models.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => handleSelectModel(m.id)}
                  className={`w-full text-left px-2 py-1.5 transition-colors hover:bg-gray-700/50 ${
                    modelId === m.id ? 'bg-blue-600/15' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-100 font-mono truncate flex-1" title={m.id}>
                      {m.id}
                    </span>
                    {m.downloads !== undefined && (
                      <span className="text-[10px] text-gray-500 shrink-0">↓ {formatCount(m.downloads)}</span>
                    )}
                  </div>
                  {m.task && <div className="text-[10px] text-blue-400/80">{m.task}</div>}
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* 区块四：文件列表 */}
        <Section
          title="文件列表"
          desc={modelId ? `模型 ${modelId} 的文件，勾选需下载的文件` : '请先在上一步选择模型'}
          actions={
            modelId ? (
              <Button variant="ghost" onClick={handleListFiles} disabled={isDownloading}>
                刷新
              </Button>
            ) : undefined
          }
        >
          {modelId ? (
            files.length > 0 ? (
              <div className="max-h-60 overflow-y-auto rounded border border-gray-700">
                {files.map(renderFileRow)}
              </div>
            ) : (
              <p className="text-xs text-gray-500">暂无文件，点击右上角「刷新」获取。</p>
            )
          ) : (
            <p className="text-xs text-gray-500">尚未选择模型。</p>
          )}
        </Section>

        {/* 区块五：下载与进度 */}
        <Section title="下载" desc="优先 HTTPS 直链；下载开始会生成清单文件记录本次内容，完成或取消时自动清理">
          <div className="space-y-2">
            <TextInput value={modelId} onChange={setModelId} mono placeholder="模型名，如 Qwen/Qwen2.5-7B-Instruct" disabled={isDownloading} />
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleDownloadHttp} disabled={isDownloading || !modelId || !localDir} className="flex-1">
                {state.mode === 'http' ? '下载中...' : '下载（HTTPS）'}
              </Button>
              {env?.modelscopeInstalled && (
                <Button
                  variant="secondary"
                  onClick={handleUseCli}
                  disabled={isDownloading || !modelId || !localDir}
                  title="使用 ModelScope Python 工具下载"
                >
                  {state.mode === 'cli' ? '下载中...' : 'Python 工具下载'}
                </Button>
              )}
              {isDownloading && (
                <Button variant="danger" onClick={cancel} title="停止下载并清理本次已下载的文件">
                  取消
                </Button>
              )}
            </div>

            {(isDownloading || state.error || state.httpFailed || state.progress > 0) && (
              <div className="pt-1">
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(state.progress, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-xs text-gray-400 truncate flex-1" title={state.currentFile}>
                    {state.currentFile || state.status}
                  </span>
                  <span className="text-xs text-blue-400 font-mono shrink-0 ml-2">
                    {state.progress.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}

            {state.httpFailed && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2">
                <p className="text-xs text-red-300">HTTPS 直链下载失败，可改用 ModelScope Python 工具继续下载。</p>
                {env?.modelscopeInstalled ? (
                  <p className="text-[11px] text-gray-400 mt-1">已安装 ModelScope，点击上方「Python 工具下载」继续。</p>
                ) : (
                  <Button variant="secondary" onClick={handleUseCli} disabled={installing} className="mt-2 w-full">
                    {installing ? '准备中...' : '安装并使用 Python 工具'}
                  </Button>
                )}
              </div>
            )}

            {error && !state.httpFailed && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </Section>
      </div>
    </div>
  );
}
