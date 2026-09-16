// =============================================================================
// 版本号解析与比较纯函数 — 主/渲染进程通用
//
// llama.cpp 自 v0.4.x 起采用双轨版本体系：
//   - 正式版 release: 语义化版本 tag，如 "v0.4.1"（releases/latest 返回）
//   - nightly 构建:   build 号 tag，如 "b10964"（二进制实际挂载处）
//
// 对应 llama-server --version 输出两种形态：
//   - 新版: "version: 0.4.1 (391fac1)"  → 语义化版本
//   - 旧版: "version: 4589 (abc123)"    → build 号
// =============================================================================

/** 语义化版本 */
export interface SemverInfo {
  kind: 'semver';
  major: number;
  minor: number;
  patch: number;
}

/** nightly build 号 */
export interface BuildInfo {
  kind: 'build';
  num: number;
}

export type VersionInfo = SemverInfo | BuildInfo;

export type CompareResult = 'up-to-date' | 'outdated' | 'unknown';

// "x.y.z" 三段式（前后不得紧跟数字/点，避免误截 "2026.3.1-x64" 之外的更长数字串）
const SEMVER_RE = /(?:^|[^\d.])v?(\d+)\.(\d+)\.(\d+)(?:[^\d.]|$)/;
// "b10964" nightly tag
const BUILD_TAG_RE = /\bb(\d+)\b/;

/** 占位文本直接判定解析失败（含 "未安装 / 未知 / 获取失败 / 查询中" 等） */
const PLACEHOLDER_PATTERNS = [
  '未安装',
  '未知',
  '获取失败',
  '查询中',
  '检测中',
];

/**
 * 解析版本字符串为结构化信息，无法解析时返回 null。
 * 优先尝试语义化版本，其次 build 号：
 *   "version: 0.4.1 (391fac1)" → { kind: 'semver', major: 0, minor: 4, patch: 1 }
 *   "v0.4.1"                   → { kind: 'semver', major: 0, minor: 4, patch: 1 }
 *   "b10964"                   → { kind: 'build', num: 10964 }
 *   "version: 4589 (abc123)"   → { kind: 'build', num: 4589 }
 */
export function parseVersionInfo(str: string): VersionInfo | null {
  if (!str) return null;
  if (PLACEHOLDER_PATTERNS.some((p) => str.includes(p))) return null;

  const s = str.trim();

  const sem = s.match(SEMVER_RE);
  if (sem) {
    return {
      kind: 'semver',
      major: parseInt(sem[1], 10),
      minor: parseInt(sem[2], 10),
      patch: parseInt(sem[3], 10),
    };
  }

  // 优先匹配 "b10964" 形式，避免 "llama-b10964-..." 之类文本误取其他数字
  const tag = s.match(BUILD_TAG_RE);
  if (tag) {
    const num = parseInt(tag[1], 10);
    if (Number.isFinite(num)) return { kind: 'build', num };
  }

  // 兜底：取第一个纯数字段（旧版 "version: 4589 (abc123)"）
  const num = s.match(/\d+/);
  if (num) {
    const n = parseInt(num[0], 10);
    if (Number.isFinite(n)) return { kind: 'build', num: n };
  }

  return null;
}

/** 无法解析 build 号时返回 null（旧接口，语义化版本字符串会返回 null） */
export function parseBuildNumber(str: string): number | null {
  const info = parseVersionInfo(str);
  return info?.kind === 'build' ? info.num : null;
}

function compareSemver(a: SemverInfo, b: SemverInfo): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  return 0;
}

/**
 * 比较本地版本与最新版本：
 *   - 双方同为语义化版本 → 逐段比较 major/minor/patch
 *   - 双方同为 build 号   → 比较纯数字
 *   - 版本体系不同或任一解析失败 → 'unknown'
 */
export function compareVersions(local: string, latest: string): CompareResult {
  const localInfo = parseVersionInfo(local);
  const latestInfo = parseVersionInfo(latest);

  if (!localInfo || !latestInfo) return 'unknown';

  if (localInfo.kind === 'semver' && latestInfo.kind === 'semver') {
    return compareSemver(localInfo, latestInfo) >= 0 ? 'up-to-date' : 'outdated';
  }
  if (localInfo.kind === 'build' && latestInfo.kind === 'build') {
    return localInfo.num >= latestInfo.num ? 'up-to-date' : 'outdated';
  }
  return 'unknown';
}

/**
 * 智能比较本地版本与远端最新版本（双轨体系）：
 *   - 本地为语义化版本（新版 llama-server）→ 与正式版 release tag 比较
 *   - 本地为 build 号（旧版 llama-server / nightly）→ 与 nightly tag 比较
 *
 * @param local         llama-server --version 输出
 * @param nightlyTag    nightly 构建 tag（如 "b10964"）
 * @param releaseTag    正式版 release tag（如 "v0.4.1"）；缺失时退回 nightlyTag
 */
export function compareWithLatest(
  local: string,
  nightlyTag: string,
  releaseTag: string,
): CompareResult {
  const localInfo = parseVersionInfo(local);
  if (!localInfo) return 'unknown';

  const target =
    localInfo.kind === 'semver' ? (releaseTag || nightlyTag) : nightlyTag;
  if (!target) return 'unknown';

  const targetInfo = parseVersionInfo(target);
  if (!targetInfo) return 'unknown';

  if (localInfo.kind === 'semver' && targetInfo.kind === 'semver') {
    return compareSemver(localInfo, targetInfo) >= 0 ? 'up-to-date' : 'outdated';
  }
  if (localInfo.kind === 'build' && targetInfo.kind === 'build') {
    return localInfo.num >= targetInfo.num ? 'up-to-date' : 'outdated';
  }
  return 'unknown';
}
