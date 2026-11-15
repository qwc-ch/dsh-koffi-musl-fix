# dsh-koffi-musl-fix

A dsh/Cordis plugin and a plain Node preload that make older [koffi](https://koffi.dev/) releases load their **musl** prebuild on Linux musl hosts, instead of aborting inside the glibc one.

Tested on Alpine Linux edge / aarch64 (TMOE + proot), Node 24, with `dsh` 0.2.2-rc.1 (which pins `koffi@3.1.1`).

## The problem

koffi's platform packages ship two prebuilt binaries:

| Directory | Target |
| --- | --- |
| `linux_<abi>/koffi.node` | glibc |
| `musl_<abi>/koffi.node` | musl |

Older koffi loaders require the glibc binary first and only fall back to the musl one when that `require` throws. On musl the glibc binary does not always fail cleanly. On Alpine aarch64 it passes `dlopen`, enters C++ initialization, throws `std::system_error` with errno 0, and aborts the process:

```text
terminate called after throwing an instance of 'std::system_error'
  what():  No error information
Aborted
```

The fallback never runs. For [dsh](https://github.com/deepseek-ai/deepseek-harness) this is fatal because `dsh-subprocess-local` uses koffi to call libc's `execve` and `fcntl`; the first agent turn spawns a subprocess and the whole `dsh web` process dies.

koffi 3.3.8 detects libc before choosing a prebuild, so this workaround is only needed for older releases (or applications that still pin them).

## What it does

On Linux/musl, before koffi is loaded, the fix rewrites:

```text
.../linux_<abi>/koffi.node  ->  .../musl_<abi>/koffi.node
```

It hooks both:

- `Module._load`, which sees koffi's relative `require("./linux_arm64/koffi.node")`;
- `process.dlopen`, which sees the absolute path Node resolved.

A request is only rewritten when the musl sibling exists. Everything else is left untouched. The fix is a no-op on glibc, macOS, Windows, and non-Linux platforms.

libc detection uses `process.report.getReport().header.glibcVersionRuntime`: Node only sets that field on glibc hosts. If the report is unavailable, the fix stays inactive rather than guessing.

## Install as a dsh plugin

The package declares a dsh bundle, so it can be installed like any other dsh plugin:

```sh
dsh plugin --profile web add dsh-koffi-musl-fix
```

Before the npm release, install from this repository or from a checkout:

```sh
# from Git
dsh plugin --profile web add git+https://github.com/qwc-ch/dsh-koffi-musl-fix.git

# from a local checkout
dsh plugin --profile web add /path/to/dsh-koffi-musl-fix
```

`dsh plugin` requires pnpm (or a launcher-provided package manager). Restart dsh after installing. On a musl host you should see:

```text
koffi-musl-fix: musl host detected; koffi will use its musl prebuild
```

The bundle layer is:

```yaml
- insert:
    - id: koffi-musl-fix
      name: dsh-koffi-musl-fix
```

### Manual home-level patch

If you do not want to install the package as a bundle, point a home-level patch at a checkout:

```yaml
# ~/.dsh/cordis.patch.yml
- insert:
    - id: koffi-musl-fix
      name: ./plugins/dsh-koffi-musl-fix/index.mjs
```

Paths in `~/.dsh/cordis.patch.yml` are relative to `~/.dsh/`. This is the setup used for local development in this repository.

Check that the row resolves:

```sh
dsh --profile web --dump-config | grep -A2 koffi-musl-fix
```

The plugin does not modify `node_modules`, and a dsh upgrade does not remove the home-level patch.

## Use as a Node preload

```sh
npm install dsh-koffi-musl-fix
NODE_OPTIONS="--import dsh-koffi-musl-fix/preload" node app.mjs
```

The preload must run before koffi's first `require`. For a local checkout:

```sh
node --import ./preload.mjs app.mjs
```

## Use programmatically

```js
import { install } from 'dsh-koffi-musl-fix/core'

const fix = install({
  onRedirect({ kind, from, to }) {
    console.error(`koffi-musl-fix: ${kind} ${from} -> ${to}`)
  },
})

// fix.active      false when this is not a Linux/musl host
// fix.redirected  number of rewritten requests
// fix.uninstall() restore the original loader hooks
```

Call `install()` before the first `require('koffi')`. Repeated calls return the same handle.

## Plugin discovery

The package carries the canonical dsh discovery metadata:

- npm keywords: `dsh-plugin`, `deepseek-harness`, `dsh`, `cordis`
- recommended GitHub topics: `dsh-plugin`, `deepseek-harness`, `dsh`, `koffi`, `musl`, `alpine`

## Tests

The redirect logic is dependency-free and tested with `node:test`:

```sh
npm test
```

The package tests also assert that `dsh.bundle.patch` is present, that `cordis.patch.yml` is published, and that the bundle row names this package.

## Limitations

- It only understands koffi's `linux_<abi>/koffi.node` / `musl_<abi>/koffi.node` layout. If koffi changes that layout, the fix silently does nothing.
- It is not a general fix for other native modules.
- It does not upgrade koffi. If your dependency range allows a version with libc detection, upgrade instead.

## License

[MIT](./LICENSE)
