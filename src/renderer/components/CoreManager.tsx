import { useState, useEffect, useCallback, useRef } from 'react';
import { useUpdater } from '../hooks/useUpdater';
import { useConfig } from '../hooks/useConfig';
import VersionCompare from './VersionCompare';
import { Section, TextInput, SelectInput, Switch, Button } from './ui';

const BACKEND_OPTIONS = [
  { value: 'vulkan', label: 'Vulkan（通用，跨平台）' },
  { value: 'rocm', label: 'ROCm（仅 Linux）' },
] as const;

// ---------------------------------------------------------------------------
// formatSize — 复用 main 端的逻辑
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 动态格式化速度单位：根据数值大小自动切换 B/s, KB/s, MB/s, GB/s */
function formatSpeed(kbps: number): string {
  if (kbps <= 0) return '0 B/s';
  const bytesPerSec = kbps * 1024;
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${kbps.toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(kbps / 1024).toFixed(2)} MB/s`;
  return `${(kbps / (1024 * 1024)).toFixed(2)} GB/s`;
}

export default function CoreManager() {
  const {
    updater,
    error,
    checkLatest,
    checkCoreExists,
    getLocalVersion,
    downloadAndExtract,
    extractSpecific,
    listDownloadedFiles,
    setProxy,
    setBackend,
  } = useUpdater();

  const { config, updateField } = useConfig();

  const [exists, setExists] = useState<boolean | null>(null);
  const [localVer, setLocalVer] = useState<string>('检测中...');
  const [latestTag, setLatestTag] = useState<string>('-');
  const [latestReleaseTag, setLatestReleaseTag] = useState<string>('');
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('最新版本');
  const [proxyInput, setProxyInput] = useState<string>('');

  // 从 config 同步代理状态
  const useProxy = config?.proxy_enabled ?? true;
  const proxySavedRef = useRef(useProxy);

  useEffect(() => {
    if (config?.proxy_url && config.proxy_url !== proxyInput) {
      setProxyInput(config.proxy_url);
    }
  }, [config?.proxy_url]); // eslint-disable-line react-hooks/exhaustive-deps

  // 保存代理开关
  const handleProxyToggle = useCallback(
    (checked: boolean) => {
      proxySavedRef.current = checked;
      updateField('proxy_enabled', checked);
    },
    [updateField],
  );

  // 失焦时保存代理地址
  const handleProxySave = useCallback(() => {
    if (proxyInput !== (config?.proxy_url ?? '')) {
      updateField('proxy_url', proxyInput);
    }
  }, [proxyInput, config?.proxy_url, updateField]);

  // 解析实际代理地址
  const getProxy = useCallback(() => {
    if (!useProxy) return '';
    return proxyInput.trim() || 'http://127.0.0.1:7890';
  }, [useProxy, proxyInput]);

  // 初始化：检查 Core 是否存在 & 获取本地版本
  const refreshStatus = useCallback(async () => {
    const ok = await checkCoreExists();
    setExists(ok);
    const ver = await getLocalVersion();
    // 截断过长版本号（Go 版截断到 40 字符）
    const v = ver || (ok ? '未知' : '未安装');
    setLocalVer(v.length > 40 ? v.slice(0, 40) : v);
  }, [checkCoreExists, getLocalVersion]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // 刷新已下载文件列表
  const refreshFiles = useCallback(async () => {
    const files = await listDownloadedFiles();
    setDownloadedFiles(files);
  }, [listDownloadedFiles]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // 检查最新版本
  const handleCheckLatest = async () => {
    // 仅当显式配置了代理地址时才传入（不传默认值，避免 127.0.0.1:7890 不可达导致失败）
    if (config?.proxy_enabled && config?.proxy_url) {
      await setProxy(config.proxy_url);
    } else if (!config?.proxy_enabled) {
      await setProxy('');
    }
    setLatestTag('查询中...');
    setLatestReleaseTag('');
    const result = await checkLatest();
    if (result) {
      setLatestTag(result.tag);
      setLatestReleaseTag(result.releaseTag);
    } else {
      setLatestTag('获取失败');
    }
  };

  // 更新 Core
  const handleUpdate = async () => {
    try {
      // 应用代理设置
      const proxy = getProxy();
      if (proxy) {
        await setProxy(proxy);
      }
      if (selectedFile === '最新版本') {
        await downloadAndExtract();
        setLatestTag(updater.latestTag || '-');
        setLatestReleaseTag(updater.latestReleaseTag || '');
      } else {
        await extractSpecific(selectedFile);
      }
      await refreshStatus();
      await refreshFiles();
    } catch {
      // 错误已在 hook 中处理
    }
  };

  // 手动刷新列表
  const handleRefreshFiles = async () => {
    await refreshFiles();
    if (selectedFile !== '最新版本' && !downloadedFiles.includes(selectedFile)) {
      setSelectedFile('最新版本');
    }
  };

  // 合并下拉选项
  const allOptions = ['最新版本', ...downloadedFiles];

  const isDownloading = updater.isDownloading;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 可滚动内容区 */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {/* 版本对比 */}
        <VersionCompare exists={exists} localVer={localVer} latestTag={latestTag} latestReleaseTag={latestReleaseTag} />

        {/* HTTP 代理 */}
        <Section
          title="网络代理"
          desc={useProxy ? `下载将通过代理进行${proxyInput.trim() ? '' : '（使用默认地址）'}` : '未启用代理'}
        >
          <div className="space-y-2">
            <Switch label="启用代理" checked={useProxy} onChange={handleProxyToggle} />
            <TextInput
              value={proxyInput}
              onChange={setProxyInput}
              onBlur={handleProxySave}
              placeholder="http://127.0.0.1:7890（留空则使用默认）"
              disabled={!useProxy}
            />
          </div>
        </Section>

        {/* GPU 后端选择 */}
        <Section
          title="GPU 后端"
          desc={
            updater.selectedBackend === 'rocm'
              ? 'ROCm 仅适用于 AMD GPU + Linux 环境'
              : 'Vulkan 适用于所有平台（NVIDIA / AMD / Intel GPU）'
          }
        >
          <SelectInput
            value={updater.selectedBackend}
            onChange={setBackend}
            options={BACKEND_OPTIONS}
            disabled={isDownloading}
          />
        </Section>

        {/* 操作 */}
        <Section title="操作" desc="检查并更新 llama-server 可执行文件">
          <div className="flex flex-col gap-3">
            <Button variant="primary" onClick={handleCheckLatest} disabled={isDownloading} className="w-full">
              检查最新版本
            </Button>

            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <SelectInput
                  value={selectedFile}
                  onChange={setSelectedFile}
                  options={allOptions.map((name) => ({ value: name, label: name }))}
                  disabled={isDownloading}
                />
              </div>
              <Button variant="primary" onClick={handleUpdate} disabled={isDownloading}>
                更新 Core
              </Button>
            </div>

            <Button variant="ghost" onClick={handleRefreshFiles} className="self-start">
              刷新文件列表
            </Button>
          </div>
        </Section>

        {/* 进度 */}
        {isDownloading && (
          <Section title="下载进度">
            <div className="mb-2">
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(updater.progress, 100)}%` }}
                />
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-gray-400">
                  {formatSize(updater.downloadedBytes)} / {formatSize(updater.downloadSize)}
                </span>
                <span className="text-xs text-blue-400 font-mono">
                  {formatSpeed(updater.downloadSpeed)}
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-1 text-right">{updater.progress.toFixed(1)}%</div>
            </div>
            <p className="text-xs text-gray-400">{updater.status}</p>
            {(updater.error || error) && (
              <p className="text-xs text-red-400 mt-1">{updater.error || error}</p>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
