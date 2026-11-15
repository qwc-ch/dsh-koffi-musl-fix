/**
 * Framework-free core: redirect koffi's glibc prebuild to its musl sibling.
 *
 * koffi's platform packages ship both `linux_<abi>/koffi.node` and
 * `musl_<abi>/koffi.node`. Older loaders require the glibc one first and only
 * fall back when that require throws. On musl the glibc DSO does not always
 * fail cleanly: it can enter C++ initialization, throw std::system_error with
 * errno 0, and abort the process. This module rewrites the request before
 * Node's loader opens it, so the fallback is never needed.
 *
 * The redirect is deliberately conservative: it only touches requests whose
 * basename is `koffi.node` under a `linux_<abi>` directory, and only when the
 * corresponding `musl_<abi>/koffi.node` actually exists.
 */
import Module from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'

const GLIBC_PREBUILD = /(^|[\\/])linux_([a-z0-9_]+)[\\/]koffi\.node$/i
const INSTALL_MARK = Symbol.for('koffi-musl-fix.installed')

let installed

/**
 * Whether this process runs on Linux with musl as its C library.
 *
 * Node's diagnostic report exposes `glibcVersionRuntime` only on glibc hosts,
 * which makes the absence of that field a reliable musl signal without
 * spawning `ldd` or reading `/etc/os-release`.
 *
 * @param {Pick<typeof process, 'platform' | 'report'>} [proc] - injectable for tests.
 * @returns {boolean}
 */
export function isMuslLinux(proc = process) {
  if (proc.platform !== 'linux') return false
  try {
    const header = proc.report?.getReport?.()?.header
    return header !== undefined && header.glibcVersionRuntime === undefined
  } catch {
    return false
  }
}

/**
 * Map a glibc prebuild path to its musl sibling, preserving the directory
 * prefix and the ABI segment.
 *
 * @param {string} path - absolute or relative path ending in `linux_<abi>/koffi.node`.
 * @returns {string | undefined} the sibling path, or `undefined` when the path
 *   does not match koffi's prebuild layout.
 */
export function muslSibling(path) {
  if (typeof path !== 'string' || !GLIBC_PREBUILD.test(path)) return undefined
  return path.replace(GLIBC_PREBUILD, '$1musl_$2/koffi.node')
}

/**
 * Rewrite one `Module._load` request.
 *
 * Relative requests are resolved against the requiring module first, because
 * koffi's loader uses `require("./linux_arm64/koffi.node")`. The returned path
 * is absolute so Node opens the musl DSO directly.
 *
 * @param {unknown} request - the request passed to `Module._load`.
 * @param {{ filename?: string } | undefined} parent - the requiring module.
 * @param {(path: string) => boolean} [exists] - injectable filesystem probe.
 * @returns {string | undefined} replacement request, or `undefined` for no change.
 */
export function rewriteRequest(request, parent, exists = existsSync) {
  if (typeof request !== 'string') return undefined
  const sibling = muslSibling(request)
  if (sibling === undefined) return undefined

  if (isAbsolute(request)) return exists(sibling) ? sibling : undefined
  if (!request.startsWith('./') && !request.startsWith('../')) return undefined
  if (typeof parent?.filename !== 'string') return undefined

  const target = resolve(dirname(parent.filename), sibling)
  return exists(target) ? target : undefined
}

/**
 * Rewrite one `process.dlopen` filename. Node resolves `.node` requests to an
 * absolute path before calling `dlopen`, so this is the second safety net.
 *
 * @param {unknown} filename - the filename passed to `process.dlopen`.
 * @param {(path: string) => boolean} [exists] - injectable filesystem probe.
 * @returns {string | undefined} replacement filename, or `undefined` for no change.
 */
export function rewriteDlopenFilename(filename, exists = existsSync) {
  if (typeof filename !== 'string' || !isAbsolute(filename)) return undefined
  const sibling = muslSibling(filename)
  return sibling !== undefined && exists(sibling) ? sibling : undefined
}

/**
 * Install the redirect hooks.
 *
 * Safe to call more than once: repeated calls return the same handle. On
 * non-musl hosts this is a no-op and returns an inactive handle.
 *
 * @param {object} [options]
 * @param {(path: string) => boolean} [options.exists] - injectable filesystem probe.
 * @param {(event: { kind: 'require' | 'dlopen', from: string, to: string }) => void} [options.onRedirect]
 *   - called for every rewritten request; errors thrown by the callback are ignored.
 * @returns {{ active: boolean, readonly redirected: number, uninstall(): void }}
 */
export function install(options = {}) {
  if (installed !== undefined) return installed

  const { exists = existsSync, onRedirect } = options

  if (!isMuslLinux()) {
    return Object.freeze({ active: false, redirected: 0, uninstall() {} })
  }

  // Another copy of this module (or an older loose-file install) already
  // patched the loader. Leave its hooks in place.
  if (Module._load?.[INSTALL_MARK] === true) {
    return Object.freeze({ active: true, redirected: 0, uninstall() {} })
  }

  const originalLoad = Module._load
  const originalDlopen = process.dlopen
  let redirected = 0

  const note = (kind, from, to) => {
    redirected += 1
    if (typeof onRedirect !== 'function') return
    try {
      onRedirect({ kind, from, to })
    } catch {
      // A diagnostic callback must never break module loading.
    }
  }

  const patchedLoad = function (request, parent, isMain) {
    const target = rewriteRequest(request, parent, exists)
    if (target === undefined) return originalLoad.call(this, request, parent, isMain)
    note('require', request, target)
    return originalLoad.call(this, target, parent, isMain)
  }
  patchedLoad[INSTALL_MARK] = true

  const patchedDlopen = function (module, filename, flags) {
    const target = rewriteDlopenFilename(filename, exists)
    if (target === undefined) return originalDlopen.call(this, module, filename, flags)
    note('dlopen', filename, target)
    return originalDlopen.call(this, module, target, flags)
  }

  Module._load = patchedLoad
  process.dlopen = patchedDlopen

  const handle = {
    active: true,
    get redirected() {
      return redirected
    },
    uninstall() {
      if (Module._load === patchedLoad) Module._load = originalLoad
      if (process.dlopen === patchedDlopen) process.dlopen = originalDlopen
      if (installed === handle) installed = undefined
    },
  }

  installed = handle
  return handle
}
