import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {describe, test} from 'node:test'
import {bitcoinAdapter} from '@hzblj/crypto-bitcoin'
import {createClearSigning, INTENTS} from '@hzblj/crypto-clear-sign'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'

import {VERSION} from '../src'

const crypto = createTestCryptoEngine({adapters: [bitcoinAdapter()]})
const chain = crypto.chains.bitcoin

describe('@hzblj/crypto-clear-sign-bitcoin', () => {
  test('the chain client and the core are reachable from the tests', () => {
    assert.equal(typeof chain.decodePsbt, 'function')
    assert.equal(
      createClearSigning({
        chain: {family: 'bitcoin', id: 'bip122:000000000019d6689c085ae165831e93', name: 'Bitcoin'},
        intent: INTENTS.unknown,
        kind: 'psbt',
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
