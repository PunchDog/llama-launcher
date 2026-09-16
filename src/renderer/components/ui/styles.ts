// =============================================================================
// 统一样式常量 — 暗色工业风：深灰面板 + 蓝色强调
// =============================================================================

/** 输入类控件（input / select）基础样式 */
export const inputBase =
  'w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 ' +
  'placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40 ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** 等宽字体输入（路径 / API Key / 命令行） */
export const monoInput = `${inputBase} font-mono`;

/** 字段标签 */
export const labelBase = 'text-xs text-gray-400 mb-1';

/** 字段补充说明 */
export const hintBase = 'text-xs text-gray-500 leading-relaxed';

/** 卡片分区容器 */
export const cardBase =
  'bg-gray-800/40 border border-gray-700 rounded-lg overflow-hidden transition-colors';

/** 卡片标题行 */
export const cardHeader = 'flex items-center gap-2 w-full px-3 py-2 text-left select-none';

/** 卡片标题文字 */
export const cardTitle = 'text-sm font-semibold text-gray-300';

/** 主色按钮 */
export const btnPrimary =
  'px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 ' +
  'disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium ' +
  'rounded transition-colors';

/** 危险按钮 */
export const btnDanger =
  'px-4 py-2 bg-red-600 hover:bg-red-700 active:bg-red-800 ' +
  'disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium ' +
  'rounded transition-colors';

/** 次要按钮 */
export const btnSecondary =
  'px-3 py-1 bg-gray-600 hover:bg-gray-500 active:bg-gray-700 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm ' +
  'rounded transition-colors';

/** 小号按钮（卡片头部操作区） */
export const btnGhost =
  'px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 ' +
  'rounded transition-colors';
