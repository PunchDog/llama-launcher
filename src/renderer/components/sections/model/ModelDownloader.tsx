import { useState, useEffect, useCallback } from 'react';
import { useModelDownloader } from '../../../hooks/useModelDownloader';
import { useConfig } from '../../../hooks/useConfig';
import { invoke } from '../../../hooks/api';
import { Section, PathInput } from '../../ui';
import { effectiveProxy } from '@/shared/proxy';
import EnvSection from './EnvSection';
import SearchSection from './SearchSection';
import FileListSection from './FileListSection';
import DownloadSection from './DownloadSection';

// =============================================================================
// ModelDownloader — 「模型下载」标签页（状态编排）
//   区块渲染拆分至 sections/model/*：环境 / 路径 / 搜索 / 文件 / 下载
// =============================================================================

export default function ModelDownloader() {
  const {
    state,
    env,
    models,
    files,
    browsed,
    selectedFiles,
    target,
    error,
    setTarget,
    installModelscope,
    searchModels,
    listFiles,
    toggleFile,
    download,
    cancel,
    setProxy,
  } = useModelDownloader();
  const { config } = useConfig();

  const [keyword, setKeyword] = useState('');
  const [localDir, setLocalDir] = useState('');
  const [installing, setInstalling] = useState(false);

  // 默认下载路径取配置里的模型目录
  useEffect(() => {
    const dir = config?.server.models_dir;
    if (dir && !localDir) setLocalDir(dir);
  }, [config?.server.models_dir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 同步代理设置到主进程下载器（规则唯一来源：shared/proxy.ts）
  useEffect(() => {
    if (!config) return;
    setProxy(effectiveProxy(config));
  }, [config?.proxy.enabled, config?.proxy.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = useCallback(async () => {
    const folder = await invoke('dialog:open-folder');
    if (folder) setLocalDir(folder);
  }, []);

  const handleSearch = useCallback(() => {
    searchModels(keyword.trim());
  }, [keyword, searchModels]);

  const handleSelectModel = useCallback(
    (id: string) => {
      setTarget(id);
      listFiles(id);
    },
    [listFiles, setTarget],
  );

  const handleListFiles = useCallback(() => {
    if (target) listFiles(target);
  }, [target, listFiles]);

  const handleDownloadHttp = useCallback(() => {
    if (!target || !localDir) return;
    download({ modelId: target, localDir, files: selectedFiles, mode: 'http' });
  }, [target, localDir, selectedFiles, download]);

  const startCliDownload = useCallback(() => {
    if (!target || !localDir) return;
    download({ modelId: target, localDir, files: selectedFiles, mode: 'cli' });
  }, [target, localDir, selectedFiles, download]);

  const handleUseCli = useCallback(async () => {
    if (!env?.modelscopeInstalled) {
      setInstalling(true);
      try {
        await installModelscope();
      } finally {
        setInstalling(false);
      }
    }
    startCliDownload();
  }, [env?.modelscopeInstalled, installModelscope, startCliDownload]);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await installModelscope();
    } finally {
      setInstalling(false);
    }
  }, [installModelscope]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        <EnvSection env={env} installing={installing} onInstall={handleInstall} />

        <Section title="下载路径" desc="模型文件保存目录，默认使用配置中的 models_dir">
          <PathInput value={localDir} onChange={setLocalDir} onPick={pickFolder} placeholder="未选择" title={localDir} />
        </Section>

        <SearchSection
          keyword={keyword}
          onKeywordChange={setKeyword}
          onSearch={handleSearch}
          models={models}
          selectedId={target}
          onSelect={handleSelectModel}
          disabled={state.isDownloading}
        />

        <FileListSection
          browsed={browsed}
          files={files}
          selectedFiles={selectedFiles}
          onToggle={toggleFile}
          onRefresh={handleListFiles}
          disabled={state.isDownloading}
        />

        <DownloadSection
          state={state}
          env={env}
          target={target}
          onTargetChange={setTarget}
          canStart={!!target && !!localDir}
          installing={installing}
          storeError={error}
          onDownloadHttp={handleDownloadHttp}
          onUseCli={handleUseCli}
          onCancel={cancel}
        />
      </div>
    </div>
  );
}
