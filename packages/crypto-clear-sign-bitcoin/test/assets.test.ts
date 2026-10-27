import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField, warningsAt} from '@hzblj/crypto-clear-sign'

import {type BitcoinCoinAssets, type BitcoinCoinQuery, clearSignPsbt} from '../src'
import {btcSignerPsbt, chain, field, has, only, runestoneScript, setup} from './support'

const INSCRIPTION = `${'ab'.repeat(32)}i0`

describe('coins holding inscriptions and runes', async () => {
  const {accounts, strangerFingerprint, xpubAccounts} = await setup()
  const {change, other, receive, segwit, taproot} = accounts

  /** The assets of each input by its index, as a resolver over the PSBT's own outpoints. */
  const resolver = (psbt: Uint8Array, byInput: Readonly<Record<number, BitcoinCoinAssets>>) => {
    const inputs = chain.decodePsbt(psbt).inputs

    return {
      assets: ({txid, vout}: BitcoinCoinQuery) => {
        const index = inputs.findIndex(input => input.txid === txid && input.vout === vout)

        return byInput[index]
      },
    }
  }

  const read = async (
    inputs: Parameters<typeof btcSignerPsbt>[0],
    outputs: Parameters<typeof btcSignerPsbt>[1],
    byInput: Readonly<Record<number, BitcoinCoinAssets>>,
    options = {}
  ) => {
    const psbt = btcSignerPsbt(inputs, outputs)

    return clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts], assets: resolver(psbt, byInput), ...options})
  }

  test('an inscription paid to a stranger is a transfer of ownership, on the output it lands in', async () => {
    const result = await read(
      [
        {account: taproot, value: 10_000n},
        {account: segwit, previous: true, value: 50_000n},
      ],
      [
        {account: other, noOrigin: true, value: 546n},
        {account: change, value: 58_000n},
      ],
      {0: {inscriptions: [{id: INSCRIPTION, offset: 0}]}}
    )
    const warning = only(result, 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual([warning.severity, warning.action, warning.fields], ['critical', [0], ['to']])
    assert.deepEqual(warning.params, {inputs: '0'})
    const count = field(result, 'input-0-inscriptions')
    assert.ok(count.kind === 'number' && count.value === 1)
    assert.equal(has(result, 'bitcoin.ASSET_KEPT'), false)
  })

  test('an inscription that stays with the signer is said to, and is no risk', async () => {
    const result = await read(
      [
        {account: taproot, value: 10_000n},
        {account: segwit, previous: true, value: 50_000n},
      ],
      [
        {account: receive, value: 546n},
        {account: other, noOrigin: true, value: 20_000n},
        {account: change, value: 38_000n},
      ],
      {0: {inscriptions: [{offset: 0}]}}
    )
    const kept = only(result, 'bitcoin.ASSET_KEPT')
    assert.deepEqual([kept.severity, kept.action, kept.fields], ['info', [], ['input-0']])
    assert.equal(has(result, 'ASSET_OWNERSHIP_TRANSFER'), false)
    assert.equal(has(result, 'bitcoin.ASSET_BURNED'), false)
    assert.equal(has(result, 'bitcoin.ASSET_DESTINATION_UNKNOWN'), false)
  })

  test('sats fill the outputs in order: an inscription in a later coin, or deep in one', async () => {
    // 10,000 sats of input 0 fill output 0; input 1's first sat is output 1's.
    const later = await read(
      [
        {account: segwit, previous: true, value: 10_000n},
        {account: taproot, value: 10_000n},
      ],
      [
        {account: other, noOrigin: true, value: 10_000n},
        {account: change, value: 9_000n},
      ],
      {1: {inscriptions: [{offset: 0}]}}
    )
    assert.equal(has(later, 'ASSET_OWNERSHIP_TRANSFER'), false)
    assert.equal(only(later, 'bitcoin.ASSET_KEPT').fields[0], 'input-1')

    // Offset 9,999 of input 0 is the last sat of output 0.
    const deep = await read(
      [
        {account: taproot, value: 10_000n},
        {account: segwit, previous: true, value: 10_000n},
      ],
      [
        {account: other, noOrigin: true, value: 10_000n},
        {account: change, value: 9_000n},
      ],
      {0: {inscriptions: [{offset: 9_999n}]}}
    )
    assert.deepEqual(only(deep, 'ASSET_OWNERSHIP_TRANSFER').action, [0])
  })

  test('without an offset, every sat of the coin counts', async () => {
    const result = await read(
      [{account: taproot, value: 10_000n}],
      [
        {account: change, value: 5_000n},
        {account: other, noOrigin: true, value: 4_000n},
      ],
      {0: {inscriptions: [{}]}}
    )
    // Its sats reach output 1 (the stranger's), and 1,000 of them go to the miner.
    const transfers = result.warnings.filter(entry => entry.code === 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual(
      transfers.map(entry => [entry.action, entry.fields]),
      [
        [[], ['input-0', 'fee']],
        [[1], ['to']],
      ]
    )

    const covered = await read(
      [{account: taproot, value: 10_000n}],
      [
        {account: change, value: 5_000n},
        {account: receive, value: 4_999n},
      ],
      {0: {inscriptions: [{}]}}
    )
    // One sat short: the last one is the fee's.
    assert.deepEqual(only(covered, 'ASSET_OWNERSHIP_TRANSFER').fields, ['input-0', 'fee'])
  })

  test('an inscription on a sat past every output goes to the fee: the miner`s', async () => {
    const result = await read([{account: taproot, value: 10_000n}], [{account: change, value: 5_000n}], {
      0: {inscriptions: [{offset: 8_000}]},
    })
    const warning = only(result, 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual([warning.action, warning.fields], [[], ['input-0', 'fee']])
  })

  test('an inscription in an OP_RETURN output is burned', async () => {
    const result = await read(
      [{account: taproot, value: 10_000n}],
      [
        {script: Uint8Array.of(0x6a, 1, 1), value: 546n},
        {account: change, value: 9_000n},
      ],
      {0: {inscriptions: [{offset: 0}]}}
    )
    const burned = only(result, 'bitcoin.ASSET_BURNED')
    assert.deepEqual([burned.severity, burned.action], ['critical', [0]])
  })

  test('where it lands cannot be worked out without every earlier coin`s value', async () => {
    const result = await read(
      [
        {account: segwit, noUtxo: true, value: 10_000n},
        {account: taproot, value: 10_000n},
      ],
      [{account: change, value: 19_000n}],
      {1: {inscriptions: [{offset: 0}]}}
    )
    const unknown = only(result, 'bitcoin.ASSET_DESTINATION_UNKNOWN')
    assert.deepEqual([unknown.severity, unknown.fields], ['high', ['input-1']])
  })

  test('signed as an offer (SINGLE|ANYONECANPAY): whoever completes it decides where the inscription goes', async () => {
    // The seller's listing: their inscribed coin, and the price paid to them at the same index. (A listing whose price
    // is more than the coin is a PSBT the adapter refuses, its outputs being more than its inputs.)
    const result = await read(
      [{account: taproot, sighashType: 0x83, value: 150_000n}],
      [{account: receive, value: 100_000n}],
      {0: {inscriptions: [{id: INSCRIPTION}]}}
    )
    const transfer = only(result, 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual([transfer.action, transfer.fields], [[], ['input-0', 'input-0-sighash']])
    assert.equal(has(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY'), true)
    assert.equal(has(result, 'bitcoin.ASSET_KEPT'), false)
  })

  test('runes without a runestone go to the first output that is not OP_RETURN', async () => {
    const toStranger = await read(
      [{account: taproot, value: 10_000n}],
      [
        {account: other, noOrigin: true, value: 546n},
        {account: change, value: 9_000n},
      ],
      {0: {runes: [{amount: 1_000n, id: '840000:3'}]}}
    )
    assert.deepEqual(only(toStranger, 'ASSET_OWNERSHIP_TRANSFER').action, [0])
    const count = field(toStranger, 'input-0-runes')
    assert.ok(count.kind === 'number' && count.value === 1)

    const toSelf = await read(
      [{account: taproot, value: 10_000n}],
      [
        {account: change, value: 546n},
        {account: other, noOrigin: true, value: 9_000n},
      ],
      {0: {runes: [{id: '840000:3'}]}}
    )
    assert.equal(only(toSelf, 'bitcoin.ASSET_KEPT').severity, 'info')
  })

  test('runes follow the edicts of their own id, and the pointer', async () => {
    const outputs = (script: Uint8Array) => [
      {script, value: 0n},
      {account: change, value: 546n},
      {account: other, noOrigin: true, value: 9_000n},
    ]
    // 840000:3 to output 2 (the stranger's), the rest by pointer to output 1 (the signer's).
    const edict = runestoneScript([22n, 1n, 0n, 840000n, 3n, 500n, 2n])
    const held = await read([{account: taproot, value: 10_000n}], outputs(edict), {
      0: {runes: [{id: '840000:3'}]},
    })
    assert.deepEqual(only(held, 'ASSET_OWNERSHIP_TRANSFER').action, [2])

    const unrelated = await read([{account: taproot, value: 10_000n}], outputs(edict), {0: {runes: [{id: '1:0'}]}})
    assert.equal(has(unrelated, 'ASSET_OWNERSHIP_TRANSFER'), false)
    assert.equal(has(unrelated, 'bitcoin.ASSET_KEPT'), true)

    // Without ids, every edict counts.
    const unnamed = await read([{account: taproot, value: 10_000n}], outputs(edict), {0: {runes: [{}]}})
    assert.deepEqual(only(unnamed, 'ASSET_OWNERSHIP_TRANSFER').action, [2])
  })

  test('a cenotaph burns the runes the signer`s coin holds', async () => {
    const result = await read(
      [{account: taproot, value: 10_000n}],
      [
        {script: runestoneScript([126n, 0n]), value: 0n},
        {account: change, value: 9_000n},
      ],
      {0: {runes: [{id: '840000:3'}]}}
    )
    const burned = only(result, 'bitcoin.ASSET_BURNED')
    assert.deepEqual([burned.action, burned.fields], [[], ['input-0']])
    assert.equal(has(result, 'bitcoin.CENOTAPH'), true)
  })

  test('the assets as a record, keyed by outpoint, read the same', async () => {
    const psbt = btcSignerPsbt(
      [{account: taproot, value: 10_000n}],
      [
        {account: other, noOrigin: true, value: 546n},
        {account: change, value: 9_000n},
      ]
    )
    const [input] = chain.decodePsbt(psbt).inputs
    assert.ok(input)
    const result = await clearSignPsbt(chain, psbt, {
      accounts: [...xpubAccounts],
      assets: {[`${input.txid}:${input.vout}`]: {inscriptions: [{id: INSCRIPTION, offset: 0}]}},
    })
    assert.deepEqual(only(result, 'ASSET_OWNERSHIP_TRANSFER').action, [0])
    assert.equal(warningsAt(result, [0]).length, 2)
  })

  test('a record without a coin`s key: nothing held there, and nothing failed', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: taproot, value: 10_000n},
        {account: segwit, previous: true, value: 20_000n},
      ],
      [
        {account: other, noOrigin: true, value: 546n},
        {account: change, value: 28_000n},
      ]
    )
    const [first] = chain.decodePsbt(psbt).inputs
    assert.ok(first)

    // Only the first coin is in the record: the second is plain bitcoin, and its absence is no failure.
    const partial = await clearSignPsbt(chain, psbt, {
      accounts: [...xpubAccounts],
      assets: {[`${first.txid}:${first.vout}`]: {inscriptions: [{id: INSCRIPTION, offset: 0}]}},
    })
    assert.deepEqual(only(partial, 'ASSET_OWNERSHIP_TRANSFER').action, [0])
    assert.ok(field(partial, 'input-0-inscriptions').kind === 'number')
    assert.equal(findField(partial, 'input-1-inscriptions'), undefined)
    assert.equal(has(partial, 'RESOLVER_FAILED'), false)

    // A record of other coins (or none): the review is the one without assets.
    const plain = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    for (const assets of [{}, {[`${first.txid}:7`]: {inscriptions: [{offset: 0}]}}]) {
      const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts], assets})
      assert.deepEqual(result, plain)
    }
  })

  test('an inscription offset past its coin`s value: on some sat of the coin, so every sat counts', async () => {
    const offset = (value: bigint | number) =>
      read(
        [{account: taproot, value: 10_000n}],
        [
          {account: change, value: 5_000n},
          {account: other, noOrigin: true, value: 4_000n},
        ],
        {0: {inscriptions: [{offset: value}]}}
      )
    const transfers = (result: Awaited<ReturnType<typeof offset>>) =>
      result.warnings
        .filter(entry => entry.code === 'ASSET_OWNERSHIP_TRANSFER')
        .map(entry => [entry.action, entry.fields])

    // Its value is 10,000 sats, the last at 9,999: from 10,000 on, the offset names none of them.
    for (const past of [10_000n, 10_001, 2n ** 64n]) {
      assert.deepEqual(
        transfers(await offset(past)),
        [
          [[], ['input-0', 'fee']],
          [[1], ['to']],
        ],
        String(past)
      )
    }

    // The near cases: the last sat is the fee's; the first is the change's, and stays.
    assert.deepEqual(transfers(await offset(9_999n)), [[[], ['input-0', 'fee']]])
    const first = await offset(0)
    assert.deepEqual(transfers(first), [])
    assert.deepEqual(only(first, 'bitcoin.ASSET_KEPT').fields, ['input-0'])
  })

  test('another wallet`s coin: its assets are shown, its transfer is theirs to worry about', async () => {
    const result = await read(
      [
        {account: segwit, previous: true, value: 100_000n},
        {account: {...other, fingerprint: strangerFingerprint}, value: 546n},
      ],
      [
        {account: receive, value: 546n},
        {account: other, noOrigin: true, value: 99_000n},
      ],
      {1: {inscriptions: [{id: INSCRIPTION}]}}
    )
    assert.equal(has(result, 'ASSET_OWNERSHIP_TRANSFER'), false)
    assert.equal(has(result, 'bitcoin.ASSET_KEPT'), false)
    const count = field(result, 'input-1-inscriptions')
    assert.ok(count.kind === 'number' && count.value === 1)
  })

  test('a resolver that throws, rejects or answers nonsense: RESOLVER_FAILED, naming assets', async () => {
    const psbt = btcSignerPsbt([{account: taproot, value: 10_000n}], [{account: other, noOrigin: true, value: 9_000n}])

    for (const assets of [
      () => {
        throw new Error('indexer down')
      },
      () => Promise.reject(new Error('indexer down')),
      () => ({inscriptions: [{id: 'not an id'}]}),
      () => ({runes: [{amount: -1n, id: '1:0'}]}),
      () => ({inscriptions: 'all of them'}),
      () => 'nonsense',
    ]) {
      const result = await clearSignPsbt(chain, psbt, {
        accounts: [...xpubAccounts],
        assets: {assets: assets as unknown as () => undefined},
      })
      assert.deepEqual(only(result, 'RESOLVER_FAILED').params, {resolvers: 'assets'})
      assert.equal(has(result, 'ASSET_OWNERSHIP_TRANSFER'), false)
    }

    const both = await clearSignPsbt(chain, psbt, {
      accounts: [...xpubAccounts],
      assets: {
        assets: () => {
          throw new Error('indexer down')
        },
      },
      resolvers: {
        names: {
          name: () => {
            throw new Error('offline')
          },
        },
      },
    })
    assert.deepEqual(only(both, 'RESOLVER_FAILED').params, {resolvers: 'names, assets'})
  })

  test('an async resolver, asked with the chain and each coin', async () => {
    const queries: BitcoinCoinQuery[] = []
    const psbt = btcSignerPsbt([{account: taproot, value: 10_000n}], [{account: other, noOrigin: true, value: 9_000n}])
    const result = await clearSignPsbt(chain, psbt, {
      accounts: [...xpubAccounts],
      assets: {
        assets: async query => {
          queries.push(query)
          await Promise.resolve()

          return {inscriptions: [{offset: 0n}]}
        },
      },
    })
    assert.equal(queries.length, 1)
    assert.equal(queries[0]?.chain.id, result.chain.id)
    assert.equal(has(result, 'ASSET_OWNERSHIP_TRANSFER'), true)
  })
})
