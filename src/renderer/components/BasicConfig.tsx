import { useState } from 'react';
import { useConfig } from '../hooks/useConfig';
import { useServer } from '../hooks/useServer';
import { Button } from './ui';
import PresetSection from './sections/PresetSection';
import ModelSection from './sections/ModelSection';
import CoreParamsSection from './sections/CoreParamsSection';
import SpecSection from './sections/SpecSection';

// =============================================================================
// BasicConfig — 编排层：预设 / 模型 / 核心参数 / 投机解码 + 启停操作
// =============================================================================

export default function BasicConfig() {
  const { config, updateField, saveConfig } = useConfig();
  const { state, startServer, stopServer, previewCommand } = useServer();
  const [showCmd, setShowCmd] = useState(false);
  const [cmdText, setCmdText] = useState('');

  if (!config) {
    return <div className="text-gray-400 text-sm">加载配置中...</div>;
  }

  const isRunning = state === 2; // Running

  const handleShowCommand = async () => {
    const cmd = await previewCommand(config);
    setCmdText(cmd);
    setShowCmd(true);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        <PresetSection config={config} saveConfig={saveConfig} />
        <ModelSection config={config} updateField={updateField} />
        <CoreParamsSection config={config} updateField={updateField} />
        <SpecSection config={config} updateField={updateField} />

        {/* 操作条 */}
        <div className="flex gap-3 pt-1">
          <Button
            variant="primary"
            onClick={() => startServer(config)}
            disabled={isRunning || state === 1}
            className="flex-1"
          >
            启动
          </Button>
          <Button
            variant="danger"
            onClick={stopServer}
            disabled={state === 0 || state === 3}
            className="flex-1"
          >
            停止
          </Button>
          <Button variant="secondary" onClick={handleShowCommand} className="px-4 py-2">
            显示命令
          </Button>
        </div>
      </div>

      {/* 命令弹窗 */}
      {showCmd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowCmd(false)}
        >
          <div
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-6 max-w-3xl w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-300 mb-3">完整启动命令</h3>
            <div className="bg-gray-950 border border-gray-700 rounded p-3 overflow-auto max-h-80">
              <code className="text-xs text-green-400 whitespace-pre-wrap break-all font-mono select-all">
                {cmdText}
              </code>
            </div>
            <div className="flex gap-3 mt-4 justify-end">
              <Button variant="primary" onClick={() => navigator.clipboard.writeText(cmdText)}>
                复制
              </Button>
              <Button variant="secondary" onClick={() => setShowCmd(false)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
