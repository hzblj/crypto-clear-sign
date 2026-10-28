import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {describe, test} from 'node:test'

import {isWarningCode, WARNINGS} from '@hzblj/crypto-clear-sign'
import {base58} from '@hzblj/nitro-crypto/adapter'

import * as api from '../src'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** The changesets waiting for a release, every package's: a release consumes them, so there may be none. */
const changesets = () =>
  readdirSync(new URL('../../../.changeset/', import.meta.url))
    .filter(file => file.endsWith('.md') && file !== 'README.md')
    .map(file => read(`../../../.changeset/${file}`))

/** Every file under `src/`, its path relative to this directory. */
const sources = (directory = '../src/'): string[] =>
  readdirSync(new URL(directory, import.meta.url)).flatMap(entry =>
    statSync(new URL(`${directory}${entry}`, import.meta.url)).isDirectory()
      ? sources(`${directory}${entry}/`)
      : [`${directory}${entry}`]
  )

/** A Solana address: the Base58 of exactly 32 bytes, written as Base58 writes it (no leading zeros added or lost). */
const isKey = (value: string) => {
  const bytes = base58.decode(value)

  return bytes.length === 32 && base58.encode(bytes) === value
}

describe('the package', () => {
  test('the documented runtime exports, and nothing internal', () => {
    assert.deepEqual(Object.keys(api).sort(), [
      'HIGH_PRIORITY_FEE',
      'IDL_LIMITS',
      'LAMPORTS_PER_SIGNATURE',
      'SOLANA_CHAIN_IDS',
      'SOLANA_PROGRAMS',
      'SOLANA_TEXTS',
      'SOLANA_TOKENS',
      'SOLANA_WARNINGS',
      'VERSION',
      'clearSignMessage',
      'clearSignTransaction',
      'createIdlResolver',
    ])
  })

  test('the exported tables are frozen', () => {
    for (const table of [
      api.IDL_LIMITS,
      api.SOLANA_CHAIN_IDS,
      api.SOLANA_PROGRAMS,
      api.SOLANA_TOKENS,
      ...Object.values(api.SOLANA_TOKENS),
      ...Object.values(api.SOLANA_TOKENS).flatMap(list => Object.values(list)),
    ]) {
      assert.ok(Object.isFrozen(table))
    }
  })

  test('every address in SOLANA_PROGRAMS and SOLANA_TOKENS is a Solana key: Base58 of 32 bytes', () => {
    const programs = Object.keys(api.SOLANA_PROGRAMS)
    const mints = Object.values(api.SOLANA_TOKENS).flatMap(list => Object.keys(list))

    assert.equal(programs.length, 28)
    assert.equal(mints.length, 6)

    for (const value of [...programs, ...mints]) {
      assert.ok(isKey(value), value)
    }

    // The near miss: one character more or less, or a character Base58 does not have, is no key.
    assert.equal(isKey('1111111111111111111111111111111'), false)
    assert.throws(() => isKey('0OIl1111111111111111111111111111'))
  })

  test('the token list is keyed by the chain ids the results carry', () => {
    assert.deepEqual(Object.keys(api.SOLANA_TOKENS).sort(), Object.values(api.SOLANA_CHAIN_IDS).sort())

    for (const list of Object.values(api.SOLANA_TOKENS)) {
      for (const token of Object.values(list)) {
        assert.ok(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 255)
        assert.match(token.symbol, /^[A-Za-z]{1,32}$/)
      }
    }
  })

  test('its codes are namespaced, and never a shared one`s', () => {
    for (const [key, definition] of Object.entries(api.SOLANA_WARNINGS)) {
      assert.equal(definition.code, `solana.${key}`)
      assert.ok(isWarningCode(definition.code))
      assert.equal(Object.hasOwn(WARNINGS, key), false, key)
    }

    for (const [group, texts] of Object.entries(api.SOLANA_TEXTS)) {
      for (const [key, entry] of Object.entries(texts)) {
        assert.equal(entry.code, `solana.${group}.${key}`)
      }
    }
  })

  test('every own warning code is asserted by a test', () => {
    const tests = readdirSync(new URL('.', import.meta.url))
      .filter(file => file.endsWith('.test.ts') && file !== 'package.test.ts')
      .map(file => read(`./${file}`))
      .join('\n')

    for (const {code} of Object.values(api.SOLANA_WARNINGS)) {
      assert.ok(tests.includes(`'${code}'`), `${code} is never asserted`)
    }
  })

  test('the docs have no em dashes: README, CLAUDE.md, the JSDoc in src, its warnings, pending changesets', () => {
    const files = sources()
    const docs = [
      read('../README.md'),
      read('../CLAUDE.md'),
      ...changesets(),
      ...files.flatMap(file => read(file).match(/\/\*\*[\s\S]*?\*\//g) ?? []),
      ...Object.values(api.SOLANA_WARNINGS).map(definition => definition.message),
      ...Object.values(api.SOLANA_TEXTS).flatMap(group => Object.values(group).map(entry => entry.text)),
    ]

    assert.ok(files.includes('../src/decoders/token.ts') && files.includes('../src/idl/decode.ts'))
    assert.ok(docs.length > 100)

    for (const doc of docs) {
      assert.doesNotMatch(doc, /—/)
    }
  })
})
