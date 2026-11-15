import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
const patch = readFileSync(`${root}/cordis.patch.yml`, 'utf8')

test('package is a dsh bundle', () => {
  assert.equal(pkg.name, 'dsh-koffi-musl-fix')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(pkg.files.includes('cordis.patch.yml'))
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  assert.ok(pkg.keywords.includes('deepseek-harness'))
})

test('bundle patch inserts the plugin row by package name', () => {
  assert.match(patch, /^\s*-\s*id:\s*koffi-musl-fix\s*$/m)
  assert.match(patch, new RegExp(`^\\s*name:\\s*${pkg.name}\\s*$`, 'm'))
})

test('package points at the public repository', () => {
  assert.equal(pkg.repository?.url, 'git+https://github.com/qwc-ch/dsh-koffi-musl-fix.git')
  assert.equal(pkg.homepage, 'https://github.com/qwc-ch/dsh-koffi-musl-fix#readme')
  assert.equal(pkg.bugs?.url, 'https://github.com/qwc-ch/dsh-koffi-musl-fix/issues')
})
