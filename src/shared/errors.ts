// =============================================================================
// errors — 异常对象归一化为可读消息（主进程与渲染层共用）
//   捕获的 unknown 未必是 Error（axios 中断、字符串 throw 等），
//   统一走 errMsg 避免 30+ 处重复的三元表达式。
// =============================================================================

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
