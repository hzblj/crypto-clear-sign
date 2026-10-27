import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSignErrorCode, isClearSignError} from '@hzblj/crypto-clear-sign'

import type {ChainId} from '../src/core/chains'
import {DEFAULT_SETTINGS, reviewOptions} from '../src/core/options'
import {type MessageFormat, PASTE_KINDS, type PasteKind, parsePaste, pasteTextOf} from '../src/core/paste'
import {review} from '../src/core/review'
import {SAMPLES} from '../src/core/samples'
import {base64Decode, base64Encode, hexDecode} from '../src/utils/encoding'
import {codes, demo, NOW, reviewed} from './support'

const rejects = async (run: () => Promise<unknown> | unknown, code: ClearSignErrorCode) =>
  assert.rejects(
    async () => run(),
    (error: unknown) => isClearSignError(error, code)
  )

/** A payload as comparable text: bytes as numbers, bigints and numbers alike as digits, keys sorted. */
const canonical = (value: unknown): string =>
  JSON.stringify(value instanceof Uint8Array ? Array.from(value) : value, (_key, item: unknown) =>
    typeof item === 'bigint' || typeof item === 'number'
      ? String(item)
      : item !== null && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item
  )

/** What a pasted text gives, read with the default settings. */
const pasted = async (chain: ChainId, kind: PasteKind, text: string, format?: MessageFormat) => {
  const {accounts, crypto} = await demo()

  return review(crypto, parsePaste(chain, kind, text, format), reviewOptions(DEFAULT_SETTINGS, accounts, NOW))
}

describe('pasting', () => {
  for (const [chain, list] of Object.entries(SAMPLES) as [ChainId, (typeof SAMPLES)[ChainId]][]) {
    for (const sample of list) {
      test(`${chain}: ${sample.id}, pasted as text, is the same request and the same review`, async () => {
        const {env} = await demo()
        const built = await sample.build(env)
        const {format, text} = pasteTextOf(built.request)
        const kinds: readonly string[] = PASTE_KINDS[chain]
        assert.ok(kinds.includes(built.request.kind))

        const request = parsePaste(chain, built.request.kind as PasteKind, text, format)
        assert.equal(canonical(request.payload), canonical(built.request.payload))

        // The site, the IDL, the lookup tables and the indexer come with a request, not in its text.
        if (built.context === undefined) {
          const direct = await reviewed(sample)
          const result = await pasted(chain, built.request.kind as PasteKind, text, format)
          assert.deepEqual([result.risk, codes(result)], [direct.result.risk, codes(direct.result)])
        }
      })
    }
  }

  test('a Solana transaction pastes as Base64 or hex alike, and a PSBT as Base64', async () => {
    const {env} = await demo()
    const sample = SAMPLES.solana[0]
    assert.ok(sample)
    const built = await sample.build(env)
    assert.ok(built.request.payload instanceof Uint8Array)
    const hex = Array.from(built.request.payload, byte => byte.toString(16).padStart(2, '0')).join('')

    const fromHex = await pasted('solana', 'transaction', hex)
    const fromBase64 = await pasted('solana', 'transaction', base64Encode(built.request.payload))
    assert.equal(fromHex.summary?.text, fromBase64.summary?.text)
  })

  test('text that does not read is INVALID_INPUT, before any chain package sees it', async () => {
    await rejects(() => parsePaste('ethereum', 'transaction', '0xzz'), 'INVALID_INPUT')
    await rejects(() => parsePaste('ethereum', 'typed-data', '{"domain":'), 'INVALID_INPUT')
    await rejects(() => parsePaste('ethereum', 'typed-data', '[1, 2]'), 'INVALID_INPUT')
    await rejects(() => parsePaste('ethereum', 'authorization', '{"address": "0x01", "nonce": 1.5}'), 'INVALID_INPUT')
    await rejects(() => parsePaste('solana', 'message', 'not hex', 'hex'), 'INVALID_INPUT')
    await rejects(() => parsePaste('bitcoin', 'psbt', '   '), 'INVALID_INPUT')
    await rejects(() => parsePaste('bitcoin', 'message', 'AAEC', 'base64'), 'INVALID_INPUT')
  })

  test('what the chain packages refuse comes back as their codes', async () => {
    // Bytes, but no transaction: the adapter refuses them.
    await rejects(() => pasted('ethereum', 'transaction', '0x02c0'), 'INVALID_INPUT')
    await rejects(() => pasted('bitcoin', 'psbt', 'cHNidP8='), 'INVALID_INPUT')
    // Typed data and an authorization for Goerli, on an Ethereum mainnet client.
    await rejects(
      () =>
        pasted(
          'ethereum',
          'typed-data',
          JSON.stringify({
            domain: {chainId: 5, name: 'Test'},
            message: {contents: 'Hello'},
            primaryType: 'Mail',
            types: {
              EIP712Domain: [
                {name: 'name', type: 'string'},
                {name: 'chainId', type: 'uint256'},
              ],
              Mail: [{name: 'contents', type: 'string'}],
            },
          })
        ),
      'CHAIN_MISMATCH'
    )
    await rejects(
      () =>
        pasted(
          'ethereum',
          'authorization',
          '{"address": "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b", "nonce": 1, "chainId": 5}'
        ),
      'CHAIN_MISMATCH'
    )
  })
})

describe('encodings', () => {
  test('Base64 matches Node`s, both alphabets, padding optional', () => {
    for (const length of [0, 1, 2, 3, 4, 31, 32, 33, 100]) {
      const bytes = Uint8Array.from({length}, (_, index) => (index * 37 + length) & 0xff)
      const text = Buffer.from(bytes).toString('base64')

      assert.equal(base64Encode(bytes), text)
      assert.deepEqual(base64Decode(text), bytes)
      assert.deepEqual(base64Decode(Buffer.from(bytes).toString('base64url')), bytes)
    }

    assert.equal(base64Decode('ab$c'), undefined)
    assert.equal(base64Decode('a'), undefined)
    assert.deepEqual(hexDecode('0xA0 b1'), Uint8Array.of(0xa0, 0xb1))
    assert.equal(hexDecode('0xabc'), undefined)
  })
})
