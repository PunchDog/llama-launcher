import { useCallback } from 'react';
import { useConfig } from '../hooks/useConfig';
import { Section, Field, TextInput, NumberInput, Switch, hintBase } from './ui';

// =============================================================================
// RpcConfig — RPC Server 开关与参数
// =============================================================================

export default function RpcConfig() {
  const { config, updateField } = useConfig();

  const handleUpdate = useCallback(
    (key: string, value: unknown) => {
      updateField(key, value);
    },
    [updateField],
  );

  if (!config) {
    return <div className="text-gray-400 text-sm">加载配置中...</div>;
  }

  const rpc = config.rpc_server;
  const enabled = rpc.enabled;

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        {/* RPC Server 开关 */}
        <Section title="RPC Server" desc="允许外部客户端通过 RPC 远程调用 llama.cpp，实现多进程并发推理">
          <div className="flex items-center gap-3">
            <Switch
              label="启用 RPC Server"
              checked={enabled}
              onChange={(v) => handleUpdate('rpc_server.enabled', v)}
            />
            <span
              className={`inline-block w-2 h-2 rounded-full ${enabled ? 'bg-green-400' : 'bg-gray-500'}`}
            />
          </div>
        </Section>

        {/* RPC 参数 */}
        <Section title="RPC 参数" desc={enabled ? undefined : '启用 RPC Server 后可编辑'} disabled={!enabled}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="RPC Host">
              <TextInput
                value={rpc.host}
                onChange={(v) => handleUpdate('rpc_server.host', v)}
                disabled={!enabled}
              />
            </Field>
            <Field label="RPC Port">
              <NumberInput
                value={rpc.port}
                onChange={(v) => handleUpdate('rpc_server.port', v)}
                min={0}
                disabled={!enabled}
              />
            </Field>
            <Field label="RPC Workers">
              <NumberInput
                value={rpc.workers}
                onChange={(v) => handleUpdate('rpc_server.workers', v)}
                min={0}
                disabled={!enabled}
              />
            </Field>
            <Field label="RPC Timeout">
              <NumberInput
                value={rpc.timeout}
                onChange={(v) => handleUpdate('rpc_server.timeout', v)}
                min={0}
                disabled={!enabled}
              />
            </Field>
          </div>
        </Section>

        <div className={hintBase}>
          <p>RPC Server 允许外部客户端通过 RPC 远程调用 llama.cpp，实现多进程并发推理。</p>
          <p className="mt-1">启用后，除正常的 HTTP API 外，llama.cpp 还会启动独立的 RPC 服务。</p>
        </div>
      </div>
    </div>
  );
}
