import { DEFAULT_CONFIG } from '@/shared/constants';
import { useConfig } from '../hooks/useConfig';
import { Section, Field, TextInput, NumberWithUnit, Switch, hintBase } from './ui';
import ParamGroupCard from './params/ParamGroupCard';

// =============================================================================
// RpcConfig — 本机 ggml-rpc-server 子进程（应用层）+ llama-server 的 --rpc 端点
//   开关/host/port 不发射到命令行，端点列表才是参数表里的 rpc.endpoints
// =============================================================================

export default function RpcConfig() {
  const { config, updateField } = useConfig();

  if (!config) {
    return <div className="text-gray-400 text-sm">加载配置中...</div>;
  }

  const rpc = config.rpc.server;
  const enabled = rpc.enabled;

  const setPort = (v: number | null): void => {
    // 端口不能留空，清空即回默认值
    void updateField('rpc.server.port', v ?? DEFAULT_CONFIG.rpc.server.port);
  };

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin">
        <Section
          title="本机 RPC Server"
          desc="在本机启动 ggml-rpc-server 暴露计算服务，llama-server 以 --rpc 客户端连接，实现跨进程/GPU 分布式推理"
        >
          <div className="flex items-center gap-3">
            <Switch
              label="启用 RPC Server"
              checked={enabled}
              onChange={(v) => updateField('rpc.server.enabled', v)}
            />
            <span
              className={`inline-block w-2 h-2 rounded-full ${enabled ? 'bg-green-400' : 'bg-gray-500'}`}
            />
          </div>
        </Section>

        <Section title="监听地址" disabled={!enabled} defaultOpen={enabled}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Host">
              <TextInput
                value={rpc.host}
                onChange={(v) => updateField('rpc.server.host', v)}
                disabled={!enabled}
              />
            </Field>
            <Field label="端口" hint="ggml-rpc-server 默认 50052">
              <NumberWithUnit
                value={rpc.port}
                onChange={setPort}
                min={0}
                max={65535}
                disabled={!enabled}
              />
            </Field>
          </div>
        </Section>

        <ParamGroupCard groupId="rpc" maxTier={2} showDesc />

        <div className={hintBase}>
          <p>启用后，启动服务器时会先拉起 core/ 目录下的 ggml-rpc-server 子进程，随 llama-server 一同启停。</p>
          <p className="mt-1">
            「RPC 端点」留空时会自动填成本机的 host:port；要连远端机器上的 rpc-server，直接填端点列表即可，
            本机开关可以关掉。
          </p>
        </div>
      </div>
    </div>
  );
}
