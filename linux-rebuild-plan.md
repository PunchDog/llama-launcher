# llama-launcher Linux 出包方案重构

> 经过 7 轮打地鼠式的修补（form-data → combined-stream → asynckit → mime-types → es-set-tostringtag → ...），
> 最终确认：**pnpm 与 electron-builder v24 在 Linux 上存在根本性不兼容**，所有 hack 都是治标不治本。
> 本文档重新梳理整个项目，给出彻底的重构方案。

---

## 一、问题根因（最终定性）

### 1.1 electron-builder v24 的依赖收集机制

electron-builder 内部调用 `app-builder`（Go 二进制）来收集要打包的 node_modules。其依赖收集策略：

| 检测到的文件 | 使用的策略 | 结果 |
|-------------|-----------|------|
| `pnpm-lock.yaml` | pnpm 依赖树解析 | 读取 lockfile 中的依赖关系 |
| `node_modules/.modules.yaml` | pnpm 虚拟存储识别 | 按虚拟存储结构收集 |
| `package-lock.json` | npm 扁平结构 walker | 遍历 node_modules 目录 |
| 无 lockfile | 通用 walker | 遍历 node_modules 目录 |

### 1.2 pnpm `node-linker=hoisted` 的陷阱

`node-linker=hoisted` 让 pnpm 生成 **npm 风格的扁平 node_modules**，但 pnpm 仍会留下：
- `pnpm-lock.yaml`（声明 pnpm 元数据）
- `node_modules/.modules.yaml`（标记 pnpm 管理状态）
- `node_modules/.pnpm/`（虚拟存储目录，即使 hoisted 也可能残留）

electron-builder 检测到这些文件后强制走 pnpm 策略，但 hoisted 结构不匹配 pnpm 的虚拟存储模型 → **transitive deps 被层层漏掉**。

### 1.3 为什么 Windows 端没问题

Windows 端之前能编译通过，是因为：
- Windows 上的 pnpm 版本/配置恰好让 `.modules.yaml` 不触发 pnpm 策略，或
- Windows 端的 electron-builder 版本行为不同，或
- 之前 Windows 端实际是用 `prebuild.js` 展平后才通过的（现在该脚本在 hoisted 模式下有害）

### 1.4 前面 7 轮修补全部失败的原因

| 轮次 | 尝试 | 为什么失败 |
|------|------|-----------|
| 1 | 加 `form-data` 到 dependencies | 治标，下一个 transitive 又缺 |
| 2 | 加 `combined-stream`/`mime-types` 等 | 无底洞，永远加不完 |
| 3 | `shamefully-hoist=true` | Linux 上 symlink 解析仍不可靠 |
| 4 | `node-linker=hoisted` + 手动加全 deps | app-builder 仍检测 pnpm 痕迹 |
| 5 | `asar: false` | 解决了 asar 截断但没解决依赖收集 |
| 6 | `hide-lockfile.js`（藏 pnpm-lock.yaml） | 漏了 `.modules.yaml` |
| 7 | `hide-pnpm.js`（藏所有 pnpm 痕迹） | 仍未彻底，或 copy/unlink 在 NTFS 挂载分区失败 |

**核心结论**：在 pnpm 管理的项目里，无法可靠地让 electron-builder 走 npm walker。**必须从根本上切换包管理器**。

---

## 二、重构方案对比

### 方案 A：整个项目切换到 npm（推荐 ✅）

**做法**：
- 删除 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.npmrc` 的 pnpm 专属配置
- 删除所有 hack 脚本（`prebuild.js`、`flatten-deps.js`、`hide-lockfile.js`、`hide-pnpm.js`）
- 用 `npm install` 生成 `package-lock.json`
- `package.json` 的 scripts 把 `pnpm` 改成 `npm`（或保留 pnpm 仅做脚本运行器，但 install 用 npm）

**优点**：
- electron-builder 原生支持 npm，零兼容性问题
- 删除 4 个 hack 脚本，构建链路极简
- Windows/Linux 行为完全一致
- 项目只有 6 个直接依赖，pnpm 的省磁盘优势可忽略

**缺点**：
- `npm install` 比 `pnpm install` 稍慢（但本项目依赖量小，差异 <10s）
- 失去 pnpm 的 workspace 能力（本项目不是 monorepo，不需要）

### 方案 B：开发用 pnpm，出包用 npm（不推荐）

**做法**：
- 保留 pnpm 做日常开发
- 出包前 `rm -rf node_modules && npm install`，生成纯 npm node_modules
- electron-builder 在纯 npm 环境下出包

**缺点**：
- 两套 lockfile 共存容易混乱
- 出包流程复杂（需要切换 install）
- CI 需要同时装 pnpm 和 npm

### 方案 C：改用 yarn（不推荐）

**做法**：切换到 yarn 包管理器

**缺点**：
- 引入新工具，无额外收益
- electron-builder 对 yarn 的支持与 npm 相当，但多一层学习成本

### 方案 D：升级 electron-builder 到 v25+（不推荐）

**做法**：升级 electron-builder，新版可能修复 pnpm 兼容性

**缺点**：
- v25 仍有 pnpm 兼容性 issue（社区反馈未完全修复）
- 升级可能引入其他 breaking change
- 不解决根本问题（pnm 虚拟存储与打包器的根本矛盾）

---

## 三、推荐方案：方案 A 详细执行步骤

### 3.1 文件清理

| 文件 | 操作 | 原因 |
|------|------|------|
| `pnpm-lock.yaml` | 删除 | 切换到 package-lock.json |
| `pnpm-workspace.yaml` | 删除 | 不再使用 pnpm |
| `scripts/prebuild.js` | 删除 | hoisted 模式下有害 |
| `scripts/flatten-deps.js` | 删除 | 不再需要展平 |
| `scripts/hide-lockfile.js` | 删除 | 不再需要藏 lockfile |
| `scripts/hide-pnpm.js` | 删除 | 不再需要藏 pnpm 痕迹 |

### 3.2 配置文件修改

#### `.npmrc`（精简）
```ini
# 仅 electron 和 esbuild 需要 postinstall 下载二进制
# （npm 通过 overrides 或 .npmrc 的 ignore-scripts 管理）
```
> npm 不支持 `onlyBuiltDependencies`（那是 pnpm 专属），但 npm 默认允许所有包跑 postinstall，所以不需要额外配置。

#### `package.json`
```json
{
  "scripts": {
    "dev": "concurrently \"vite\" \"tsc -p tsconfig.main.json --watch\" \"electron .\"",
    "build": "tsc -p tsconfig.main.json && vite build",
    "build:electron": "tsc -p tsconfig.main.json",
    "build:renderer": "vite build",
    "preview": "vite preview",
    "pack": "electron-builder --dir",
    "dist": "npm run build && electron-builder"
  },
  "dependencies": {
    "adm-zip": "^0.5.10",
    "axios": "^1.6.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tar": "^6.2.0",
    "zustand": "^4.4.7"
  }
}
```
> 删除 `flatten-deps` 脚本，`dist` 简化为 `npm run build && electron-builder`。

#### `electron-builder.yml`（保留现状）
```yaml
appId: com.llama.launcher
productName: llama-launcher
directories:
  output: release
  buildResources: resources

win:
  target:
    - target: dir
      arch: [x64]

linux:
  target:
    - target: dir
      arch: [x64]
  category: Utility

asar: false

extraResources:
  - from: core/
    to: core/
  - from: downloads/
    to: downloads/
  - from: config.json
    to: config.json

files:
  - "**/*"
  - "!tests/**"
  - "!scripts/**"
  - "!.workbuddy/**"
  - "!.git/**"
  - "!release/**"
  - "!dist/**"
  - "!_*/**"

npmRebuild: false
nodeGypRebuild: false
```
> `asar: false` 保留（双保险）；`linux` 段保留；其他不变。

### 3.3 执行步骤

```bash
# 1. 清理 pnpm 痕迹
rm -rf node_modules pnpm-lock.yaml pnpm-workspace.yaml
rm -f scripts/prebuild.js scripts/flatten-deps.js scripts/hide-lockfile.js scripts/hide-pnpm.js

# 2. 用 npm 安装
npm install

# 3. 出包
npm run dist

# 产物：release/linux-unpacked/
```

### 3.4 Windows 端兼容性

Windows 端同样改用 `npm install` + `npm run dist`，行为完全一致。之前的 Windows 编译通过是因为 `prebuild.js` 在 pnpm symlink 模式下恰好工作，切换到 npm 后该脚本不再需要，构建链路更简单更可靠。

---

## 四、重构后的构建链路对比

### 重构前（7 个文件协同，仍失败）
```
pnpm install
  ↓ (生成 pnpm-lock.yaml + .modules.yaml + .pnpm/)
pnpm build
  ↓ (tsc + vite)
node scripts/hide-pnpm.js hide
  ↓ (藏 pnpm-lock.yaml + .modules.yaml + .pnpm/lock.yaml)
electron-builder
  ↓ (app-builder 检测不到 pnpm → 走 npm walker → 但 node_modules 结构可能仍残留 pnpm 特征)
node scripts/hide-pnpm.js restore
  ↓ (恢复 pnpm 痕迹)
❌ 运行时 Cannot find module 'xxx'
```

### 重构后（极简，可靠）
```
npm install
  ↓ (生成 package-lock.json + 扁平 node_modules，无任何 pnpm 痕迹)
npm run build
  ↓ (tsc + vite)
electron-builder
  ↓ (app-builder 检测到 package-lock.json → 走 npm walker → 完美匹配扁平 node_modules)
✅ 运行时所有模块正常加载
```

---

## 五、为什么这是唯一可靠方案

1. **electron-builder 对 npm 的支持是一等公民**：electron-builder 官方文档的所有示例都用 npm，CI 测试也以 npm 为主。
2. **npm 的 node_modules 是天然扁平结构**：与 electron-builder 的 node_modules walker 完美匹配，无需任何 hack。
3. **本项目依赖量小**：6 个直接依赖，pnpm 的省磁盘/快安装优势可忽略不计。
4. **消除所有 hack**：4 个脚本文件 + 2 个临时配置全部删除，构建链路从 7 步缩减到 3 步。
5. **Windows/Linux 行为一致**：同一套 `npm install && npm run dist` 在两个平台都可靠工作。

---

## 六、风险与回退

### 风险
- **低**：npm install 比 pnpm 慢约 5-10s（本项目规模下可忽略）
- **低**：失去 pnpm 的严格依赖隔离（本项目无 phantom dependency 问题）

### 回退方案
如果切换到 npm 后出现新问题，可回退到 pnpm + 方案 B（开发用 pnpm，出包用 npm）。但根据分析，方案 A 应能一次性解决所有问题。

---

## 七、执行清单

- [ ] 删除 `pnpm-lock.yaml`、`pnpm-workspace.yaml`
- [ ] 删除 `scripts/prebuild.js`、`scripts/flatten-deps.js`、`scripts/hide-lockfile.js`、`scripts/hide-pnpm.js`
- [ ] 精简 `.npmrc`（删除 pnpm 专属配置）
- [ ] 修改 `package.json`：scripts 简化，删除 pnpm 字段
- [ ] `rm -rf node_modules && npm install`
- [ ] `npm run dist` 验证 Linux 出包
- [ ] Windows 端验证 `npm run dist` 回归
