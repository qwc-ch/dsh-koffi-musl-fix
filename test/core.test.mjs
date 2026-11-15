import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isMuslLinux,
  muslSibling,
  rewriteDlopenFilename,
  rewriteRequest,
} from '../lib/core.mjs'

const KOFFI = '/app/node_modules/@koromix/koffi-linux-arm64'
const MUSL = `${KOFFI}/musl_arm64/koffi.node`

test('muslSibling maps every Linux ABI directory', () => {
  assert.equal(muslSibling(`${KOFFI}/linux_arm64/koffi.node`), MUSL)
  assert.equal(muslSibling('./linux_x64/koffi.node'), './musl_x64/koffi.node')
  assert.equal(muslSibling('../linux_riscv64/koffi.node'), '../musl_riscv64/koffi.node')
  assert.equal(muslSibling('/opt/linux_ia32/koffi.node'), '/opt/musl_ia32/koffi.node')
})

test('muslSibling ignores unrelated files', () => {
  assert.equal(muslSibling('/app/linux_arm64/other.node'), undefined)
  assert.equal(muslSibling('/app/linux_arm64/koffi.node.bak'), undefined)
  assert.equal(muslSibling('/app/musl_arm64/koffi.node'), undefined)
  assert.equal(muslSibling(42), undefined)
})

test('rewriteRequest resolves a relative require against its parent', () => {
  const exists = (path) => path === MUSL
  const parent = { filename: `${KOFFI}/index.js` }

  assert.equal(
    rewriteRequest('./linux_arm64/koffi.node', parent, exists),
    MUSL,
  )
})

test('rewriteRequest rewrites an absolute request', () => {
  const request = `${KOFFI}/linux_arm64/koffi.node`
  const exists = (path) => path === MUSL

  assert.equal(rewriteRequest(request, undefined, exists), MUSL)
})

test('rewriteRequest leaves the request alone when the musl sibling is missing', () => {
  const exists = () => false
  const request = `${KOFFI}/linux_arm64/koffi.node`

  assert.equal(rewriteRequest(request, undefined, exists), undefined)
  assert.equal(
    rewriteRequest('./linux_arm64/koffi.node', { filename: `${KOFFI}/index.js` }, exists),
    undefined,
  )
})

test('rewriteRequest ignores unrelated modules and unresolvable requests', () => {
  const exists = () => true

  assert.equal(rewriteRequest('node:fs', undefined, exists), undefined)
  assert.equal(rewriteRequest('koffi', undefined, exists), undefined)
  assert.equal(rewriteRequest('@koromix/koffi-linux-arm64', undefined, exists), undefined)
  assert.equal(rewriteRequest('./linux_arm64/koffi.node', undefined, exists), undefined)
})

test('rewriteDlopenFilename rewrites an absolute glibc prebuild path', () => {
  const filename = `${KOFFI}/linux_arm64/koffi.node`
  const exists = (path) => path === MUSL

  assert.equal(rewriteDlopenFilename(filename, exists), MUSL)
  assert.equal(rewriteDlopenFilename('./linux_arm64/koffi.node', exists), undefined)
  assert.equal(rewriteDlopenFilename('/app/linux_arm64/other.node', exists), undefined)
})

test('isMuslLinux reads the absence of glibcVersionRuntime', () => {
  const report = (header) => ({ getReport: () => ({ header }) })

  assert.equal(isMuslLinux({ platform: 'linux', report: report({}) }), true)
  assert.equal(
    isMuslLinux({ platform: 'linux', report: report({ glibcVersionRuntime: '2.39' }) }),
    false,
  )
  assert.equal(
    isMuslLinux({ platform: 'darwin', report: report({}) }),
    false,
  )
  assert.equal(
    isMuslLinux({ platform: 'linux', report: { getReport: () => { throw new Error('nope') } } }),
    false,
  )
  assert.equal(isMuslLinux({ platform: 'linux' }), false)
})
