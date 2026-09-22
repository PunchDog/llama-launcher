import { useState } from 'react';
import { useConfig } from '../hooks/useConfig';
import { useServer } from '../hooks/useServer';
import { Button, Modal, CopyButton } from './ui';
import PresetSection from './sections/PresetSection';
import ParamGroupCard from './params/ParamGroupCard';
import ParamToolbar from './params/ParamToolbar';

// =============================================================================
// BasicConfig — 编排层：预设 / 常用参数 / 投机解码 + 启停操作
//   参数字段一律由参数元数据（src/shared/params/groups）渲染，
//   这里只决定「哪几张卡片、看到第几层」，新增参数不需要改本文件
// =============================================================================

const BASIC_GROUPS = ['server', 'model', 'memory', 'compute', 'speculative'] as const;

export default function BasicConfig() {
  const { config, error: configError } = useConfig();
  const { state, error, startServer, stopServer, previewCommand } = useServer();
  const [showCmd, setShowCmd] = useState(false);
  const [cmdText, setCmdText] = useState('');

  if (!config) {
    return (
      <div className="text-gray-400 text-sm">
        {configError ? `加载配置失败：${configError}` : '加载配置中...'}
      </div>
    );
  }

  const isRunning = state === 2; // Running

  const handleShowCommand = async (): Promise<void> => {
    setCmdText(await previewCommand());
    setShowCmd(true);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        <PresetSection config={config} />
        <ParamToolbar groups={BASIC_GROUPS} />

        {BASIC_GROUPS.map((groupId) => (
          <ParamGroupCard key={groupId} groupId={groupId} maxTier={0} columns={4} />
        ))}

        {/* 操作条：启动前由 serverStore 自动 flush 未保存的配置 */}
        <div className="flex gap-3 pt-1">
          <Button variant="primary" onClick={startServer} disabled={isRunning || state === 1} className="flex-1">
            启动
          </Button>
          <Button variant="danger" onClick={stopServer} disabled={state === 0 || state === 3} className="flex-1">
            停止
          </Button>
          <Button variant="secondary" onClick={handleShowCommand} className="px-4 py-2">
            显示命令
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">启动失败：{error}</p>}
        {configError && <p className="text-xs text-red-400">配置写入失败：{configError}</p>}
      </div>

      <Modal
        open={showCmd}
        title="完整启动命令"
        onClose={() => setShowCmd(false)}
        footer={<Button variant="secondary" onClick={() => setShowCmd(false)}>关闭</Button>}
      >
        <div className="bg-gray-950 border border-gray-700 rounded p-3 overflow-auto max-h-80">
          <code className="text-xs text-green-400 whitespace-pre-wrap break-all font-mono select-all">
            {cmdText}
          </code>
        </div>
        <div className="mt-2 flex justify-end">
          <CopyButton text={cmdText} />
        </div>
      </Modal>
    </div>
  );
}
