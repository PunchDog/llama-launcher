# llama-launcher 在 Linux 下编译通过性分析

> 分析对象：`llama-launcher`（Electron + Vite + React + TypeScript + Tailwind + pnpm）
> 分析目标：厘清「编译通过（pnpm build / electron-builder 打包成功）」与「运行可用（在 Linux 上真正跑起来）」两层概念，给出可落地的步骤与需要改动的点。

---

## 一、项目技术栈与构建链路总览

| 层级 | 技术 | 产物 | 跨平台性 |
|------|------|------|----------|
| 主进程 | TypeScript → CommonJS | `dist-electron/main/*.js` | ✅ 纯 Node API，跨平台 |
| 预加载 | TypeScript → CommonJS | `dist-electron/preload/*.js` | ✅ 跨平台 |
| 渲染进程 | React + Vite | `dist-renderer/` | ✅ 跨平台 |
| 样式 | Tailwind + PostCSS | `dist-renderer/*.css` | ✅ 跨平台 |
| 打包 | electron-builder | `release/` | ⚠️ 当前 `electron-builder.yml` **只配了 win 目标** |
| 外部二进制 | llama.cpp（Vulkan/CPU） | `core/*.exe + *.dll` | ❌ **当前 core 目录全是 Windows 二进制** |

构建脚本链路：
```
pnpm build  =  tsc -p tsconfig.main.json  &&  vite build
pnpm dist   =  pnpm build  &&  electron-builder
pnpm flatten-deps = node scripts/prebuild.js   （展平 pnpm symlink 供 electron-builder 打包）
```

---

## 二、「编译通过」分析（pnpm build / electron-builder）

### 2.1 TypeScript + Vite 编译 —— ✅ Linux 下天然可编译

源码层面**没有** Windows 平台特定 API：
- `src/main/*.ts` 全部使用 Node.js 标准 API（`fs`、`path`、`child_process`、`worker_threads`、`os`）。
- 平台差异已通过 `process.platform === 'win32'` / `os.platform()` 做了分支处理（见 `paths.ts:48`、`server.ts:59`、`server.ts:246`）。
- `tsconfig.main.json` 输出 CommonJS，`tsconfig.json` 输出 ESNext，均与平台无关。

**结论**：在 Linux 装 Node.js + pnpm 后，`pnpm build` 可直接成功，无需改源码。

### 2.2 `pnpm install` 的潜在阻塞点

| 文件 | 内容 | 问题 |
|------|------|------|
| `package.json` → `pnpm.onlyBuiltDependencies` | `["electron", "esbuild"]` | ✅ 正确，允许两者跑 postinstall |
| `pnpm-workspace.yaml` | `allowBuilds: { electron: "set this to true or false", esbuild: "set this to true or false" }` | ⚠️ **这是占位符文本，非合法 pnpm 字段**。pnpm 会忽略未知字段，但建议清理或改成 `onlyBuiltDependencies` 列表，避免误导 |

`electron@28` 的 postinstall 会下载 Electron 预编译二进制（~200MB），Linux 下需要：
- 网络可达 `https://github.com/electron/electron/releases`（或配置 `ELECTRON_MIRROR`）。
- 系统已装 electron 运行时依赖（见 2.4）。

`esbuild` 的 postinstall 会下载对应平台二进制，Linux 下自动取 linux-x64 版本，无额外配置。

### 2.3 `electron-builder` 打包 —— ❌ 当前配置无法打出 Linux 包

当前 `electron-builder.yml`：
```yaml
win:
  target:
    - target: dir
      arch: [x64]
```
**只定义了 `win` 目标，没有 `linux` 段。** 在 Linux 上执行 `electron-builder` 会因为找不到当前平台目标而报错或默认打 dir。

**需新增 `linux` 段**（最小改动）：
```yaml
linux:
  target:
    - target: dir          # 调试首选，产出可直接运行的目录
      arch: [x64]
  # 如需分发可加：
  # - target: AppImage
  # - target: deb
  category: Utility
```

注意 `extraResources`（core/、downloads/、config.json）是平台无关的，Linux 段会继承同一份配置，无需重复。

### 2.4 Linux 系统 dependencies（electron 运行/打包必需）

electron-builder 在 Linux 打包时会校验系统库，缺失会报 `dpkg`/依赖错误。最小依赖清单（Ubuntu/Debian）：

```bash
sudo apt-get install -y \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libdrm2 libgbm1 libasound2 \
  libcurl4
```

打包 `deb`/`AppImage` 还需要：`dpkg`、`fakeroot`（AppImage 还需 `appimagetool`，electron-builder 会自动下载）。

### 2.5 `scripts/prebuild.js` —— ✅ 跨平台

展平 pnpm symlink 用的是 `fs.lstatSync` + `isSymbolicLink` + `readlinkSync`，Linux 原生 symlink 与 Windows junction 通用处理。在 Linux 下可直接运行，无需改动。

---

## 三、「运行可用」分析（编译通过 ≠ 能跑）

这是本项目在 Linux 下落地的**真正难点**：即使打包成功，应用启动后仍会因以下问题无法正常使用。

### 3.1 `core/` 目录全是 Windows 二进制 ❌

`core/` 下 52 个文件全部是 `.exe` / `.dll`（Vulkan 版 + 多种 CPU 微架构变体 + `libomp140.x86_64.dll`）。Linux 下这些文件**完全无法执行**。

**解决路径**：代码已预留 Linux 下载能力——
- `constants.ts:28` 定义 `OS_KEYWORD_MAP.linux = 'bin-ubuntu-rocm'`。
- `paths.ts:48` `getServerExePath()` 已按 `process.platform === 'win32'` 判断后缀。
- 应用内的 `CoreUpdater` 可从 GitHub release 下载 Linux 版 llama.cpp。

**但前提是 3.2 的解压逻辑要修好**，否则下载后无法解压出可用文件。

### 3.2 解压逻辑硬编码 `.exe`/`.dll` 过滤 ❌ 关键阻塞

`src/main/core-updater.ts` 三个解压函数均写死只提取 Windows 文件：

| 函数 | 行号 | 硬编码过滤 |
|------|------|-----------|
| `extractZipSync` | ~169 | `if (!baseName.endsWith('.exe') && !baseName.endsWith('.dll')) continue;` |
| `extractTarGz` | ~205 | 同上 |
| `extract7zSync` | ~271 | `if (lower.endsWith('.exe') || lower.endsWith('.dll'))` |
| `walkAndFlatten` | ~639 | 只展平 `.exe`/`.dll` 到 core 根 |
| 错误提示 | ~181/214/277 | `'zip 中未找到任何 exe/dll 文件'` |

**Linux 版 llama.cpp 包内是**：无后缀可执行文件（`llama-server`、`llama-cli` 等）+ `.so` 共享库（`libllama.so`、`libggml.so` 等）。

**必须改造为按平台动态过滤**，示例：
```ts
function isTargetBinary(baseName: string): boolean {
  const lower = baseName.toLowerCase();
  if (process.platform === 'win32') {
    return lower.endsWith('.exe') || lower.endsWith('.dll');
  }
  // Linux/macOS：可执行文件无后缀 + .so
  // 需结合 tar/zip 的 mode 位判断（可执行位）或白名单前缀
  return lower.endsWith('.so') || /^llama-|^rpc|^llama$/.test(lower);
}
```

> 注意：Linux 包里 `llama-server` 这类可执行文件没有后缀，靠扩展名过滤会漏掉，更稳妥的做法是解压后用 `fs.chmod` 赋可执行权限 + 按文件名白名单（`llama-server`、`llama-cli`、`llama-bench` 等）筛选。

### 3.3 `7za.exe` 路径硬编码 ❌

`extract7zSync`（~240 行）：
```ts
const local7za = path.join(CoreDir(), '7za.exe');
```
Linux 下应为 `7za` 或 `7z`（需装 `p7zip-full`）。当前 `core/` 里也没有 `7za.exe`，实际依赖 PATH 里的 `7z` 兜底。Linux 下需确保 `p7zip` 已安装，或随包附带 linux 版 `7za` 二进制。

### 3.4 `config.json` 硬编码 Windows 路径 ⚠️

- `config.json:2` → `"models_dir": "D:\\models\\unsloth"`
- `constants.ts:75` → `DEFAULT_CONFIG.models_dir = 'D:\\models\\lmstudio-community'`

Linux 下该路径无效，首次启动需手动改配置。建议默认值按平台生成：
```ts
models_dir: process.platform === 'win32'
  ? 'D:\\models\\lmstudio-community'
  : path.join(os.homedir(), 'models'),
```

### 3.5 `CoreUpdater.selectedOS` 默认 `windows` ⚠️

`core-updater.ts:345` `selectedOS = 'windows'` 硬编码。应初始化为：
```ts
selectedOS = process.platform === 'win32' ? 'windows'
           : process.platform === 'darwin' ? 'darwin' : 'linux';
```

### 3.6 进程管理 ✅ 已做平台分支

`server.ts` 的 `stop()` 已区分：
- Windows → `taskkill /PID xxx /T /F`
- Unix → `SIGTERM` → 5s 后 `SIGKILL`

这部分 Linux 下可直接工作，无需改动。

### 3.7 代理环境变量处理 ✅

`buildChildEnv` 显式置空 `HTTP_PROXY` 等，跨平台通用。

---

## 四、Linux 下编译通过的完整步骤

### 步骤 1：环境准备
```bash
# Node.js 18+ 与 pnpm
node -v   # 建议 18.x 或 20.x
npm i -g pnpm

# electron 运行时依赖
sudo apt-get install -y libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 \
  xdg-utils libatspi2.0-0 libdrm2 libgbm1 libasound2 libcurl4
```

### 步骤 2：修复 `pnpm-workspace.yaml`
当前是占位符文本，建议改为：
```yaml
# 如非 monorepo，此文件可删除；onlyBuiltDependencies 已在 package.json 中配置
onlyBuiltDependencies:
  - electron
  - esbuild
```
或直接删除该文件（package.json 里已配）。

### 步骤 3：安装依赖
```bash
cd llama-launcher
pnpm install
```

### 步骤 4：编译（TS + Vite）
```bash
pnpm build
# = tsc -p tsconfig.main.json && vite build
# 产物：dist-electron/ + dist-renderer/
```
此步在 Linux 下应直接通过（源码无平台特定 API）。

### 步骤 5：修改 `electron-builder.yml` 添加 linux 目标
```yaml
linux:
  target:
    - target: dir
      arch: [x64]
  category: Utility
```

### 步骤 6：展平依赖 + 打包
```bash
pnpm flatten-deps     # 展平 pnpm symlink
pnpm dist             # = pnpm build && electron-builder
# 产物：release/linux-unpacked/
```

### 步骤 7（运行时）：下载 Linux 版 core
启动应用后，通过内置 CoreUpdater 选择 "Linux ROCm" 下载 `bin-ubuntu-rocm` 包——**但需要先完成 3.2 的解压逻辑改造**，否则下载后解压不出任何文件。

---

## 五、改动清单（按优先级）

| 优先级 | 文件 | 改动 | 类型 |
|--------|------|------|------|
| P0 | `electron-builder.yml` | 新增 `linux.target` 段 | 打包必需 |
| P0 | `src/main/core-updater.ts` | 解压过滤改为按平台动态判断（.so + 无后缀可执行） | 运行必需 |
| P0 | `src/main/core-updater.ts` | `walkAndFlatten` 同步改造 + Linux 下 `chmod +x` | 运行必需 |
| P1 | `src/main/core-updater.ts` | `selectedOS` 默认值按 `process.platform` 初始化 | 体验 |
| P1 | `src/shared/constants.ts` | `DEFAULT_CONFIG.models_dir` 按平台生成 | 体验 |
| P1 | `src/main/core-updater.ts` | `7za.exe` → 按平台选 `7za`/`7z` | 运行 |
| P2 | `pnpm-workspace.yaml` | 清理占位符或删除 | 规范 |
| P2 | `config.json` | `models_dir` 改为 Linux 路径（或运行时覆盖） | 体验 |

---

## 六、结论

1. **「编译通过」层面**：本项目源码天然跨平台，Linux 下装好 Node + pnpm + electron 系统依赖后，`pnpm build` 可直接成功。**唯一阻塞打包的是 `electron-builder.yml` 缺 `linux` 目标段**——加 4 行配置即可。

2. **「运行可用」层面**：真正的难点在 `core-updater.ts` 的解压逻辑对 `.exe`/`.dll` 的硬编码过滤，以及 `core/` 目录当前全是 Windows 二进制。需要改造解压过滤 + 默认 OS 选择 + models_dir 默认值后，才能在 Linux 上完整使用。

3. **最小可验证路径**：先改 `electron-builder.yml` 打出 `dir` 包验证编译链路，再逐步改造 `core-updater.ts` 解压逻辑实现运行时可用。

---

## 七、已实施修改（2026-07-02）

### 7.1 `electron-builder.yml`
- 新增 `linux.target: [{target: dir, arch: [x64]}], category: Utility`，Windows 配置保持不变。

### 7.2 `src/main/core-updater.ts`
- 新增 `isTargetBinary(fileName, stat?)` — 按 `process.platform` 动态判断：
  - Windows: `.exe` / `.dll`
  - Linux/macOS: `.so` / `.dylib` + 无后缀可执行文件（`/^(llama|rpc|ggml|...)/` 前缀匹配）+ tar 流中通过 `stat.mode & 0o111` 解析可执行权限位
- 新增 `noBinaryError(format)` — 按平台生成中文错误提示
- `extractZipSync` — `.toLowerCase()` 去除 + 改用 `isTargetBinary(baseName)` 过滤
- `extractTarGz` — 同上 + 传入 `{ mode: stat.mode }` 赋能可执行权限位检测
- `extract7zSync` — `7za.exe` 路径改为平台感知 (`win32 ? '7za.exe' : '7za'`)；变量 `exeDllNames` → `targetNames`；过滤改用 `isTargetBinary`
- `walkAndFlatten` — 过滤改用 `isTargetBinary(entry.name)`；非 Windows 平台解压后调用 `fs.chmodSync(0o755)` 赋可执行权限
- `selectedOS` 默认值 — 由 `'windows'` 改为 `process.platform` 判定

### 7.3 `src/main/config.ts`
- `defaultConfig()` — 非 Windows 平台自动替换 `D:\\...` 为 `~/models`
- `loadConfig()` — 加载已有 config.json 后检查 models_dir 是否为 Windows 盘符路径，在 Linux 下自动替换
- 新增 `import * as os from 'os'`

### 7.4 `pnpm-workspace.yaml`
- 占位符文本替换为合法 pnpm workspace 配置

### 向后兼容性
- 所有 `process.platform === 'win32'` 分支逻辑不变
- `electron-builder.yml` 的 `win` 段完全保留
- `config.json` 硬编码路径仅在有此文件且被 `extraResources` 打包时影响 Linux，已通过 `loadConfig()` 的运行时修正兜底
- Windows 端编译/运行路径零变更
