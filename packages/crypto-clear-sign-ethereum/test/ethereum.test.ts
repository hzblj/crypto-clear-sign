import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describe, test} from 'node:test'

import {createClearSigning, INTENTS} from '@hzblj/crypto-clear-sign'
import {ethereumAdapter} from '@hzblj/crypto-ethereum'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'

import {VERSION} from '../src'

const crypto = createTestCryptoEngine({adapters: [ethereumAdapter()]})
const chain = crypto.chains.ethereum

describe('@hzblj/crypto-clear-sign-ethereum', () => {
  test('the chain client and the core are reachable from the tests', () => {
    assert.equal(typeof chain.parseTransaction, 'function')
    assert.equal(
      createClearSigning({
        chain: {family: 'ethereum', id: 'eip155:1', name: 'Ethereum'},
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
