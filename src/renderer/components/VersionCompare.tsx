import { useMemo } from 'react';
import { compareWithLatest } from '../../shared/version';
import { Section } from './ui';

// =============================================================================
// VersionCompare — 版本对比独立组件
//   展示 Core 状态 / 当前版本 / 最新版本 / 更新状态
// =============================================================================

interface VersionCompareProps {
  /** Core 是否已安装（null = 检测中） */
  exists: boolean | null;
  /** llama-server --version 输出（如 "version: 0.4.1 (391fac1)" 或 "未安装"/"未知"） */
  localVer: string;
  /** GitHub 最新 nightly 构建 tag（如 "b10964" 或 "-" / "获取失败" / "查询中..."） */
  latestTag: string;
  /** GitHub 正式版 release tag（如 "v0.4.1"），缺失时退回 latestTag */
  latestReleaseTag?: string;
}

interface UpdateStatusView {
  text: string;
  className: string;
}

function getUpdateStatusView(
  result: ReturnType<typeof compareWithLatest>,
  exists: boolean | null,
  latestTag: string,
): UpdateStatusView {
  // 未查询到最新版本（未点过"检查最新版本"或查询失败）
  const latestUnknown = latestTag === '-' || latestTag === '获取失败' || latestTag === '查询中...';
  if (exists === null || latestUnknown) {
    return { text: '无法比较', className: 'text-gray-500' };
  }
  if (!exists) {
    return { text: '未安装', className: 'text-gray-500' };
  }
  switch (result) {
    case 'up-to-date':
      return { text: '✓ 已是最新', className: 'text-green-400' };
    case 'outdated':
      return { text: '↑ 有新版本', className: 'text-orange-400' };
    default:
      return { text: '无法比较', className: 'text-gray-500' };
  }
}

export default function VersionCompare({ exists, localVer, latestTag, latestReleaseTag = '' }: VersionCompareProps) {
  const status = useMemo(
    () => getUpdateStatusView(
      compareWithLatest(localVer, latestTag, latestReleaseTag || latestTag),
      exists,
      latestTag,
    ),
    [localVer, latestTag, latestReleaseTag, exists],
  );

  return (
    <Section title="Core 管理" desc="llama-server 可执行文件版本状态与更新提示">
      <div className="space-y-2">
        <StatusRow label="状态">
          {exists === null ? (
            <span className="text-gray-400">检测中...</span>
          ) : exists ? (
            <span className="text-green-400">已安装</span>
          ) : (
            <span className="text-red-400">未安装</span>
          )}
        </StatusRow>
        <StatusRow label="当前版本">
          <span className="text-gray-300 font-mono text-xs truncate max-w-[260px] inline-block align-bottom" title={localVer}>{localVer}</span>
        </StatusRow>
        <StatusRow label="最新版本">
          <span className="text-gray-300 font-mono text-xs">{latestTag}</span>
        </StatusRow>
        <StatusRow label="更新状态">
          <span className={`text-sm font-medium ${status.className}`}>{status.text}</span>
        </StatusRow>
      </div>
    </Section>
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-gray-500 w-16 shrink-0">{label}：</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
