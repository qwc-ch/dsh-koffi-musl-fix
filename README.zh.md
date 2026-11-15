# dsh-koffi-musl-fix

一个 dsh/Cordis 插件，同时也是一个通用 Node 预加载模块：让旧版 [koffi](https://koffi.dev/) 在 Linux musl 环境下加载 **musl 预编译二进制**，而不是在 glibc 版本里直接 abort。

已在 Alpine Linux edge / aarch64（TMOE + proot）、Node 24、`dsh` 0.2.2-rc.1（固定依赖 `koffi@3.1.1`）上验证。

## 问题背景

koffi 的平台包同时包含两个预编译二进制：

| 目录 | 目标 |
| --- | --- |
| `linux_<abi>/koffi.node` | glibc |
| `musl_<abi>/koffi.node` | musl |

旧版 koffi 加载器先 `require` glibc 版本，只有它抛错时才回退到 musl 版本。但在 musl 上，glibc 版本不一定“干净地失败”：在 Alpine aarch64 上它能通过 `dlopen`，进入 C++ 初始化后抛出 errno 为 0 的 `std::system_error`，直接终止进程：

```text
terminate called after throwing an instance of 'std::system_error'
  what():  No error information
Aborted
```

回退逻辑根本没机会执行。对 [dsh](https://github.com/deepseek-ai/deepseek-harness) 来说这是致命问题：`dsh-subprocess-local` 用 koffi 调用 libc 的 `execve` 和 `fcntl`，第一个 agent turn 启动子进程时，整个 `dsh web` 进程就会退出。

koffi 3.3.8 已改为先检测 libc 再选择二进制，所以这个补丁只适用于旧版本（或仍固定旧版本的应用）。

## 工作原理

在 Linux/musl 上、koffi 被加载之前，把请求重定向：

```text
.../linux_<abi>/koffi.node  ->  .../musl_<abi>/koffi.node
```

同时拦截两个入口：

- `Module._load`：覆盖 koffi 加载器里的相对路径 `require("./linux_arm64/koffi.node")`；
- `process.dlopen`：覆盖 Node 解析后的绝对路径。

只有 `musl_<abi>/koffi.node` 确实存在时才改写，其余请求原样放行。在 glibc、macOS、Windows 以及非 Linux 平台上完全 no-op。

libc 检测使用 `process.report.getReport().header.glibcVersionRuntime`：Node 只在 glibc 主机上设置该字段。如果拿不到报告，补丁保持不启用，不做猜测。

## 作为 dsh 插件安装

包内声明了 dsh bundle，可以像普通 dsh 插件一样安装：

```sh
dsh plugin --profile web add dsh-koffi-musl-fix
```

npm 发布前，可以直接从仓库或本地目录安装：

```sh
# 从 Git 安装
dsh plugin --profile web add git+https://github.com/qwc-ch/dsh-koffi-musl-fix.git

# 从本地目录安装
dsh plugin --profile web add /path/to/dsh-koffi-musl-fix
```

`dsh plugin` 需要 pnpm（或启动器提供的包管理器）。安装后重启 dsh，在 musl 主机上会看到：

```text
koffi-musl-fix: musl host detected; koffi will use its musl prebuild
```

bundle 层内容为：

```yaml
- insert:
    - id: koffi-musl-fix
      name: dsh-koffi-musl-fix
```

### 手动 home 级补丁

如果不想把包作为 bundle 安装，也可以在 home 级补丁里直接指向本地目录：

```yaml
# ~/.dsh/cordis.patch.yml
- insert:
    - id: koffi-musl-fix
      name: ./plugins/dsh-koffi-musl-fix/index.mjs
```

`~/.dsh/cordis.patch.yml` 里的路径相对于 `~/.dsh/`。本仓库的本地开发就是这种挂载方式。

确认配置能解析：

```sh
dsh --profile web --dump-config | grep -A2 koffi-musl-fix
```

插件不会修改 `node_modules`，升级 dsh 也不会丢失 home 级补丁。

## 作为 Node 预加载使用

```sh
npm install dsh-koffi-musl-fix
NODE_OPTIONS="--import dsh-koffi-musl-fix/preload" node app.mjs
```

预加载必须在 koffi 第一次 `require` 之前执行。使用本地目录时：

```sh
node --import ./preload.mjs app.mjs
```

## 编程方式使用

```js
import { install } from 'dsh-koffi-musl-fix/core'

const fix = install({
  onRedirect({ kind, from, to }) {
    console.error(`koffi-musl-fix: ${kind} ${from} -> ${to}`)
  },
})

// fix.active      非 Linux/musl 主机上为 false
// fix.redirected  已改写的请求数量
// fix.uninstall() 恢复原始加载器钩子
```

需要在第一次 `require('koffi')` 之前调用 `install()`。重复调用会返回同一个 handle。

## 插件发现标签

包内带有 dsh 生态的发现元数据：

- npm keywords：`dsh-plugin`、`deepseek-harness`、`dsh`、`cordis`
- 建议的 GitHub topics：`dsh-plugin`、`deepseek-harness`、`dsh`、`koffi`、`musl`、`alpine`

## 测试

重定向逻辑无运行时依赖，使用 `node:test` 覆盖：

```sh
npm test
```

包测试还会检查 `dsh.bundle.patch` 是否存在、`cordis.patch.yml` 是否会发布，以及 bundle 行是否指向本包。

## 限制

- 只识别 koffi 的 `linux_<abi>/koffi.node` / `musl_<abi>/koffi.node` 目录结构；koffi 若改变布局，补丁会静默不生效。
- 不是其它原生模块的通用修复方案。
- 不会升级 koffi。如果依赖范围允许，优先升级到已修复 libc 检测的版本。

## 许可证

[MIT](./LICENSE)
