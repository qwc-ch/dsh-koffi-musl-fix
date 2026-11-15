/**
 * dsh / Cordis plugin entry point.
 *
 * Mount this from a profile or home-level patch:
 *
 *   - insert:
 *       - id: koffi-musl-fix
 *         name: /path/to/koffi-musl-fix/index.mjs
 *
 * The plugin is a no-op outside Linux/musl.
 */
import { install, isMuslLinux } from './lib/core.mjs'

export { install, isMuslLinux, muslSibling, rewriteRequest } from './lib/core.mjs'

export const name = 'koffi-musl-fix'

/**
 * Mount the redirect for the lifetime of the Cordis context.
 *
 * @param {{ effect(callback: () => () => void): void }} ctx - Cordis context.
 */
export function apply(ctx) {
  if (!isMuslLinux()) return

  const fix = install()
  if (!fix.active) return

  ctx.effect(() => () => fix.uninstall())

  console.log('koffi-musl-fix: musl host detected; koffi will use its musl prebuild')
}
