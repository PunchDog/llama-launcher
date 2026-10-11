import { Section, Button } from '../../ui';
import type { ModelScopeEnvState } from '@/shared/types';

// =============================================================================
// EnvSection — Python / ModelScope 运行环境状态与一键安装
//   HTTPS 直链下载不依赖本环境；仅在失败回退到 Python 工具时需要
// =============================================================================

interface EnvSectionProps {
  env: ModelScopeEnvState | null;
  installing: boolean;
  onInstall: () => void;
}

function StatusValue({ ok, version }: { ok: boolean; version: string }) {
  return ok ? (
    <span className="text-emerald-400">{version}</span>
  ) : (
    <span className="text-red-400">未安装</span>
  );
}

export default function EnvSection({ env, installing, onInstall }: EnvSectionProps) {
  const needInstall = env && (!env.pythonInstalled || !env.modelscopeInstalled);

  return (
    <Section title="运行环境" desc="HTTPS 直链下载无需环境；失败回退到 ModelScope Python 工具时需要">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400">Python</span>
          <span className="text-xs font-mono text-right flex-1 min-w-0 truncate">
            {env ? <StatusValue ok={env.pythonInstalled} version={env.pythonVersion} /> : '检测中...'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-400">ModelScope</span>
          <span className="text-xs font-mono text-right flex-1 min-w-0 truncate">
            {env ? (
              <StatusValue ok={env.modelscopeInstalled} version={env.modelscopeVersion} />
            ) : (
              '检测中...'
            )}
          </span>
        </div>
        {needInstall && (
          <Button
            variant="primary"
            onClick={onInstall}
            disabled={installing || !env?.pythonInstalled}
            className="w-full"
          >
            {installing ? '安装中...' : '安装 ModelScope'}
          </Button>
        )}
        {env && !env.pythonInstalled && (
          <p className="text-[11px] text-red-400">未检测到 Python，请先安装 Python 3 后再安装 ModelScope。</p>
        )}
      </div>
    </Section>
  );
}
