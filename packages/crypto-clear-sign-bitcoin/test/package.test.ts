import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {describe, test} from 'node:test'

import {isWarningCode, WARNINGS} from '@hzblj/crypto-clear-sign'

import * as api from '../src'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the package', () => {
  test('VERSION matches package.json', () => {
    assert.equal(api.VERSION, JSON.parse(read('../package.json')).version)
  })

  test('the documented runtime exports, and nothing internal', () => {
    assert.deepEqual(Object.keys(api).sort(), [
      'BITCOIN_CHAIN_IDS',
      'BITCOIN_TEXTS',
      'BITCOIN_WARNINGS',
      'DEFAULT_MAX_FEE',
      'DEFAULT_MAX_FEE_PERCENT',
      'DEFAULT_MAX_FEE_RATE',
      'VERSION',
      'clearSignMessage',
      'clearSignPsbt',
    ])
  })

  test('its codes are namespaced, and never a shared one`s', () => {
    for (const [key, definition] of Object.entries(api.BITCOIN_WARNINGS)) {
      assert.equal(definition.code, `bitcoin.${key}`)
      assert.ok(isWarningCode(definition.code))
      assert.equal(Object.hasOwn(WARNINGS, key), false, key)
      assert.doesNotMatch(definition.message, /—/)
    }

    for (const [group, texts] of Object.entries(api.BITCOIN_TEXTS)) {
      for (const [key, entry] of Object.entries(texts)) {
        assert.equal(entry.code, `bitcoin.${group}.${key}`)
      }
    }
  })

  test('every own warning code is raised by a test, and checked not raised by one', () => {
    const tests = readdirSync(new URL('.', import.meta.url))
      .filter(file => file.endsWith('.test.ts') && file !== 'package.test.ts')
      .map(file => read(`./${file}`))
      .join('\n')

    for (const {code} of Object.values(api.BITCOIN_WARNINGS)) {
      assert.ok(tests.includes(`'${code}'`), `${code} is never asserted`)
    }
  })

  test('the docs have no em dashes: README, CLAUDE.md, the JSDoc in src, the changeset', () => {
    const sources = readdirSync(new URL('../src', import.meta.url)).map(file => read(`../src/${file}`))
    const docs = [
      read('../README.md'),
      read('../CLAUDE.md'),
      read('../../../.changeset/clear-sign-bitcoin.md'),
      ...sources.flatMap(source => source.match(/\/\*\*[\s\S]*?\*\//g) ?? []),
    ]

    for (const doc of docs) {
      assert.doesNotMatch(doc, /—/)
    }
  })
})
