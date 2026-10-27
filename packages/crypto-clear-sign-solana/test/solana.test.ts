import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describe, test} from 'node:test'

import {createClearSigning, INTENTS} from '@hzblj/crypto-clear-sign'
import {solanaAdapter} from '@hzblj/crypto-solana'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'

import {VERSION} from '../src'

const crypto = createTestCryptoEngine({adapters: [solanaAdapter()]})
const chain = crypto.chains.solana

describe('@hzblj/crypto-clear-sign-solana', () => {
  test('the chain client and the core are reachable from the tests', () => {
    assert.equal(typeof chain.decodeMessage, 'function')
    assert.equal(
      createClearSigning({
        chain: {family: 'solana', id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', name: 'Solana'},
        intent: INTENTS.unknown,
        kind: 'transaction',
        source: {kind: 'unknown'},
      }).risk,
      'none'
    )
  })

  test('VERSION matches package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.equal(VERSION, manifest.version)
  })
})
