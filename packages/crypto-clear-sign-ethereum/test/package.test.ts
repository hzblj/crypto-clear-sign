import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {describe, test} from 'node:test'

import {isWarningCode, WARNINGS} from '@hzblj/crypto-clear-sign'

import * as api from '../src'
import * as registry from '../src/registry'

const ROOT = new URL('../', import.meta.url).pathname
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

const sources = (directory: string): string[] =>
  readdirSync(path.join(ROOT, directory))
    .sort()
    .flatMap(entry => {
      const relative = path.join(directory, entry)

      return statSync(path.join(ROOT, relative)).isDirectory()
        ? sources(relative)
        : entry.endsWith('.ts')
          ? [relative]
          : []
    })

describe('the package', () => {
  test('VERSION matches package.json', () => {
    assert.equal(api.VERSION, JSON.parse(read('package.json')).version)
  })

  test('the runtime exports of the main entry, and nothing internal', () => {
    assert.deepEqual(Object.keys(api).sort(), [
      'ETHEREUM_TEXTS',
      'ETHEREUM_TOKENS',
      'ETHEREUM_WARNINGS',
      'MULTICALL3',
      'PERMIT2',
      'VERSION',
      'clearSignAuthorization',
      'clearSignMessage',
      'clearSignTransaction',
      'clearSignTypedData',
      'createDescriptorResolver',
      'mergeDescriptors',
    ])
    assert.equal(api.PERMIT2, '0x000000000022D473030F116dDEE9F6B43aC78BA3')
    assert.equal(api.MULTICALL3, '0xcA11bde05977b3631167028862bE2a173976CA11')
    assert.ok(Object.isFrozen(api.ETHEREUM_TOKENS) && api.ETHEREUM_TOKENS.every(token => Object.isFrozen(token)))
  })

  test('the runtime exports of /registry', () => {
    assert.deepEqual(Object.keys(registry).sort(), ['ETHEREUM_REGISTRY', 'REGISTRY_SOURCE', 'registryResolver'])
    assert.ok(Object.isFrozen(registry.REGISTRY_SOURCE) && Object.isFrozen(registry.REGISTRY_SOURCE.files))
  })

  test('the entries in package.json point at the sources and the build', () => {
    const manifest = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(manifest.exports), ['.', './registry', './package.json'])
    assert.equal(manifest.exports['.'].source, './src/index.ts')
    assert.equal(manifest.exports['./registry'].source, './src/registry/index.ts')
    assert.ok(!JSON.stringify(manifest.publishConfig.exports).includes('source'))
    assert.deepEqual(Object.keys(manifest.peerDependencies), ['@hzblj/nitro-crypto'])
    assert.ok('@hzblj/crypto-ethereum' in manifest.dependencies)
  })

  test("the package's codes: namespaced, stable severities, and every one in the README", () => {
    const readme = read('README.md')
    const severities = Object.fromEntries(
      Object.values(api.ETHEREUM_WARNINGS).map(definition => [definition.code, definition.severity])
    )
    assert.deepEqual(severities, {
      'ethereum.CONTRACT_CREATION': 'info',
      'ethereum.INVALID_DESCRIPTOR': 'low',
      'ethereum.MALFORMED_SIGN_IN': 'medium',
      'ethereum.SIGN_IN_ACCOUNT_MISMATCH': 'high',
      'ethereum.SIGN_IN_CHAIN_MISMATCH': 'medium',
      'ethereum.SIGN_IN_DOMAIN_MISMATCH': 'high',
      'ethereum.SIGN_IN_URI_MISMATCH': 'medium',
      'ethereum.UNEXPECTED_VALUE': 'medium',
      'ethereum.UNKNOWN_SPENDER': 'high',
      'ethereum.UNLIMITED_AMOUNT': 'medium',
      'ethereum.UNREADABLE_FIELD': 'medium',
    })

    for (const code of [...Object.keys(severities), ...Object.values(WARNINGS).map(definition => definition.code)]) {
      assert.ok(isWarningCode(code), code)
      assert.ok(readme.includes(`| \`${code}\` |`), `${code} in the README's warnings`)
    }

    for (const [group, entries] of Object.entries(api.ETHEREUM_TEXTS)) {
      for (const [key, entry] of Object.entries(entries as Record<string, {readonly code: string}>)) {
        assert.equal(entry.code, `ethereum.${group}.${key}`)
        assert.ok(readme.includes(`\`${key}\``), `${entry.code} in the README's texts`)
      }
    }
  })

  test('docs copy has no em dashes: the README, CLAUDE.md and the JSDoc that is the API reference', () => {
    const files = ['README.md', 'CLAUDE.md', ...sources('src')]
    assert.ok(files.length > 20)

    for (const file of files) {
      assert.ok(!read(file).includes('—'), file)
    }
  })
})
