// =============================================================================
// child-env — llama-server / 版本探测子进程共用的环境变量构造
//   非 Windows 必须把 core 目录加进 LD_LIBRARY_PATH，否则 llama-server
//   找不到同目录的 libggml.so / libllama.so（server.ts 与 GetLocalVersion 同规则）
// =============================================================================

export function prependCoreLibPath(
  env: Record<string, string | undefined>,
  coreDir: string,
): void {
  if (process.platform === 'win32') return;
  env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
    ? `${coreDir}:${env.LD_LIBRARY_PATH}`
    : coreDir;
}
