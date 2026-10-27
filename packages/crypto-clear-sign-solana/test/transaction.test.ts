import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField, isClearSignError, plainText} from '@hzblj/crypto-clear-sign'
import {isCryptoError} from '@hzblj/nitro-crypto/adapter'
import type {Address} from '@solana/kit'
import {getSetComputeUnitPriceInstruction} from '@solana-program/compute-budget'
import {getAdvanceNonceAccountInstruction, getTransferSolInstruction} from '@solana-program/system'

import {clearSignTransaction} from '../src'
import {
  address,
  addressOf,
  asyncResolvers,
  BLOCKHASH,
  chain,
  clear,
  clock,
  codes,
  codesAt,
  compile,
  FRIEND,
  field,
  first,
  OTHER,
  raw,
  STRANGER,
  signer,
  syncResolvers,
  throwingResolvers,
  WALLET,
  warningOf,
  wire,
} from './support'

const as = (value: string) => value as Address
const TABLE = address(60)
const PROGRAM = address(61)
const send = (to: string, lamports = 1_000n, from = WALLET) =>
  getTransferSolInstruction({amount: lamports, destination: as(to), source: signer(from)})

/** A v0 message that loads its recipient from a lookup table. */
const lookedUp = () => {
  const tables = {[TABLE]: [OTHER, STRANGER]}

  return {message: compile([send(STRANGER)], {tables, version: 0}), tables}
}

const rejects = async (run: () => Promise<unknown>, code: string, cause?: (error: unknown) => boolean) => {
  await assert.rejects(run, error => {
    assert.ok(isClearSignError(error, code as 'INVALID_INPUT'), `${code}`)
    assert.ok(cause === undefined || cause((error as Error).cause), 'cause')

    return true
  })
}

describe('clearSignTransaction', () => {
  test('the root: the fee payer, the fee, what the wallet sends, the blockhash, the version', async () => {
    const result = await clear([send(STRANGER, 2_000_000_000n)])

    assert.equal(result.kind, 'transaction')
    assert.deepEqual(result.chain, {family: 'solana', id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', name: 'Solana'})
    assert.deepEqual(result.source, {decoder: 'solana-transaction', kind: 'builtin'})
    assert.equal(addressOf(result, 'feePayer').relation, 'self')
    assert.equal(field(result, 'fee', 'amount').value, 5_000n)
    assert.equal(field(result, 'recentBlockhash', 'text').value, BLOCKHASH)
    assert.equal(field(result, 'version', 'text').value, 'legacy')
    assert.equal(field(result, 'computeUnitLimit', 'number').value, 3_000)
    assert.equal(findField(result, 'priorityFee'), undefined)
    assert.equal(findField(result, 'signers'), undefined)

    const sent = field(result, 'sent', 'list').items
    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.kind === 'amount' && sent[0].value, 2_000_000_000n)
  })

  test('the devnet client`s results are for devnet', async () => {
    const {devnet} = await import('./support')
    const result = await clearSignTransaction(devnet, {message: compile([send(STRANGER)])})

    assert.deepEqual(result.chain, {
      family: 'solana',
      id: 'solana:EtWTRABZaYq6iMfeYKouRu166VL2xqa1',
      name: 'Solana devnet',
    })
  })

  test('the wire transaction and its message read the same', async () => {
    const message = compile([send(STRANGER)])
    const fromWire = await clearSignTransaction(chain, wire(message), {resolvers: {clock}, signer: WALLET})
    const fromMessage = await clearSignTransaction(chain, {message}, {resolvers: {clock}, signer: WALLET})

    assert.deepEqual(fromWire, fromMessage)
  })

  test('offline, with sync resolvers, with async ones: the same model, names where resolvers give them', async () => {
    const instructions = [send(FRIEND)]
    const offline = await clear(instructions)
    const sync = await clear(instructions, {resolvers: syncResolvers})
    const later = await clear(instructions, {resolvers: asyncResolvers})

    assert.equal(addressOf(first(offline), 'recipient').relation, 'unknown')
    assert.deepEqual(codesAt(offline, [0]), ['UNKNOWN_DESTINATION'])
    assert.equal(addressOf(first(sync), 'recipient').name, 'Friend')
    assert.deepEqual(codesAt(sync, [0]), [])
    assert.deepEqual(later, sync)
  })

  test('RESOLVER_FAILED: resolvers that throw and reject; the result still comes, warning more, never less', async () => {
    const result = await clear([send(FRIEND), raw(PROGRAM, [[WALLET, 'w']], [1, 2])], {resolvers: throwingResolvers})
    const raised = warningOf(result, 'RESOLVER_FAILED')

    assert.equal(raised.severity, 'info')
    assert.deepEqual(raised.action, [])
    assert.equal(raised.params?.resolvers, 'tokens, names, descriptors')
    assert.deepEqual(codesAt(result, [0]), ['UNKNOWN_DESTINATION'])
    assert.deepEqual(codesAt(result, [1]), ['UNKNOWN_CONTRACT_CALL'])
  })

  test('a resolver that answers nonsense counts as no answer', async () => {
    const result = await clear([send(FRIEND)], {
      resolvers: {names: {name: () => ({name: 'Friend‮', relation: 'contact'}) as never}},
    })

    assert.equal(addressOf(first(result), 'recipient').relation, 'unknown')
    assert.ok(codes(result).includes('RESOLVER_FAILED'))
  })

  test('NOT_FEE_PAYER: the signer signs, another pays; not when the signer pays', async () => {
    const paid = await clear([send(STRANGER, 1n, OTHER)], {feePayer: STRANGER, signer: OTHER})
    const raised = warningOf(paid, 'solana.NOT_FEE_PAYER')

    assert.equal(raised.severity, 'low')
    assert.deepEqual(raised.fields, ['feePayer'])
    assert.deepEqual(raised.action, [])

    const own = await clear([send(STRANGER)])
    assert.ok(!codes(own).includes('solana.NOT_FEE_PAYER'))
  })

  test('OTHER_SIGNERS: more signers than the signer, listed; not for the signer alone', async () => {
    const shared = await clear([send(STRANGER, 1n, OTHER)])
    const raised = warningOf(shared, 'solana.OTHER_SIGNERS')

    assert.equal(raised.severity, 'low')
    assert.deepEqual(raised.fields, ['signers'])
    assert.deepEqual(
      field(shared, 'signers', 'list').items.map(item => item.kind === 'address' && item.value),
      [WALLET, OTHER]
    )
    assert.ok(!codes(await clear([send(STRANGER)])).includes('solana.OTHER_SIGNERS'))
  })

  test('OTHER_SIGNERS without a signer: when there is more than one', async () => {
    const shared = await clear([send(STRANGER, 1n, OTHER)], {signer: undefined})
    const alone = await clear([send(STRANGER)], {signer: undefined})

    assert.ok(codes(shared).includes('solana.OTHER_SIGNERS'))
    assert.ok(!codes(alone).includes('solana.OTHER_SIGNERS'))
    assert.ok(!codes(alone).includes('solana.NOT_FEE_PAYER'))
  })

  test('UNRESOLVED_LOOKUPS: a looked-up recipient without its table is its table and index', async () => {
    const {message} = lookedUp()
    const result = await clearSignTransaction(chain, {message}, {resolvers: {clock}, signer: WALLET})
    const action = first(result)
    const recipient = field(action, 'recipient', 'list')
    const raised = warningOf(result, 'solana.UNRESOLVED_LOOKUPS')

    assert.equal(field(result, 'version', 'text').value, 'v0')
    assert.equal(field(result, 'lookupTables', 'list').items.length, 1)
    assert.deepEqual(
      recipient.items.map(item => item.id),
      ['recipient.lookupTable', 'recipient.lookupIndex']
    )
    assert.equal(field(action, 'recipient.lookupIndex', 'number').value, 1)
    assert.equal(raised.severity, 'medium')
    assert.deepEqual(raised.action, [0])
    assert.deepEqual(raised.fields, ['recipient'])
    assert.deepEqual(codesAt(result, [0]).sort(), ['UNKNOWN_DESTINATION', 'solana.UNRESOLVED_LOOKUPS'])
  })

  test('UNRESOLVED_LOOKUPS: not with the tables as an option, nor from the resolver', async () => {
    const {message, tables} = lookedUp()
    const option = await clearSignTransaction(chain, {message}, {addressLookupTables: tables, signer: WALLET})
    const asked: string[] = []
    const resolved = await clearSignTransaction(
      chain,
      {message},
      {
        resolvers: {
          lookupTables: {
            lookupTable: async query => {
              asked.push(query.address)
              assert.equal(query.chain.id, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')

              return tables[query.address]
            },
          },
        },
        signer: WALLET,
      }
    )

    for (const result of [option, resolved]) {
      assert.ok(!codes(result).includes('solana.UNRESOLVED_LOOKUPS'))
      assert.equal(addressOf(first(result), 'recipient').value, STRANGER)
    }

    assert.deepEqual(asked, [TABLE])
  })

  test('a lookup table resolver that fails, or answers what the message cannot use, is RESOLVER_FAILED', async () => {
    const {message} = lookedUp()

    for (const lookupTable of [
      () => {
        throw new Error('rpc down')
      },
      () => 'not a table' as never,
      () => [OTHER],
    ]) {
      const result = await clearSignTransaction(chain, {message}, {resolvers: {lookupTables: {lookupTable}}})

      assert.equal(warningOf(result, 'RESOLVER_FAILED').params?.resolvers, 'lookupTables')
      assert.ok(codes(result).includes('solana.UNRESOLVED_LOOKUPS'))
    }
  })

  test('lookup tables given as an option that the message does not fit are INVALID_ARGUMENT', async () => {
    const {message} = lookedUp()

    await rejects(
      () => clearSignTransaction(chain, {message}, {addressLookupTables: {[TABLE]: [OTHER]}}),
      'INVALID_ARGUMENT'
    )
  })

  test('DURABLE_NONCE: a first advanceNonceAccount never expires: high, with the nonce account and value', async () => {
    const nonceAccount = address(62)
    const result = await clear([
      getAdvanceNonceAccountInstruction({nonceAccount: as(nonceAccount), nonceAuthority: signer(WALLET)}),
      send(STRANGER),
    ])
    const raised = warningOf(result, 'solana.DURABLE_NONCE')

    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.action, [])
    assert.deepEqual(raised.fields, ['nonceAccount', 'nonce', 'expiry'])
    assert.equal(addressOf(result, 'nonceAccount').value, nonceAccount)
    assert.equal(field(result, 'nonce', 'text').value, BLOCKHASH)
    assert.equal(field(result, 'expiry', 'datetime').never, true)
    assert.equal(findField(result, 'recentBlockhash'), undefined)
    assert.equal(result.intent.code, 'intent.send')
    assert.equal(result.risk, 'high')
  })

  test('DURABLE_NONCE: not for a recent blockhash', async () => {
    const result = await clear([send(STRANGER)])

    assert.ok(!codes(result).includes('solana.DURABLE_NONCE'))
    assert.equal(findField(result, 'expiry'), undefined)
  })

  test('the intent: one instruction`s when it is the only one that is not set-up, a batch otherwise', async () => {
    const one = await clear([getSetComputeUnitPriceInstruction({microLamports: 1n}), send(STRANGER)])
    assert.equal(one.intent.code, 'intent.send')
    assert.equal(one.summary?.code, 'summary.send')

    const two = await clear([send(STRANGER), send(FRIEND)])
    assert.equal(two.intent.code, 'intent.batch')
    assert.equal(two.summary?.params?.count, 2)

    const budget = await clear([getSetComputeUnitPriceInstruction({microLamports: 1n})])
    assert.equal(budget.intent.code, 'solana.intent.setComputeUnitPrice')

    const none = await clear([])
    assert.equal(none.intent.code, 'intent.unknown')
    assert.equal(none.summary, undefined)
  })

  test('nesting: one action per instruction, in order, each with its risk; the root`s the most serious', async () => {
    const result = await clear([send(FRIEND), raw(PROGRAM, [[WALLET, 'sw']], [7]), send(STRANGER)], {
      resolvers: syncResolvers,
    })

    assert.deepEqual(
      result.actions.map(action => action.path),
      [[0], [1], [2]]
    )
    assert.deepEqual(
      result.actions.map(action => action.risk),
      ['none', 'high', 'low']
    )
    assert.equal(result.risk, 'high')
    assert.deepEqual(
      result.warnings.map(entry => entry.code),
      ['UNKNOWN_CONTRACT_CALL', 'UNKNOWN_DESTINATION']
    )
  })

  test('UNKNOWN_CONTRACT_CALL: a program nothing reads, its accounts by role and its data raw', async () => {
    const result = await clear([
      raw(
        PROGRAM,
        [
          [WALLET, 'sw'],
          [STRANGER, 'w'],
          [FRIEND, ''],
        ],
        [1, 2, 3]
      ),
    ])
    const action = first(result)
    const raised = warningOf(result, 'UNKNOWN_CONTRACT_CALL')

    assert.deepEqual(action.source, {kind: 'unknown'})
    assert.equal(action.intent.code, 'intent.contractCall')
    assert.equal(raised.severity, 'high')
    assert.deepEqual(raised.fields, ['program'])
    assert.equal(field(action, 'data', 'raw').value, '0x010203')
    assert.deepEqual(
      action.raw.map(item => item.label.code),
      [
        'label.data',
        'solana.label.writableSignerAccount',
        'solana.label.writableAccount',
        'solana.label.readonlyAccount',
      ]
    )
  })

  test('errors: bytes the adapter refuses are INVALID_INPUT with its error as the cause', async () => {
    const message = compile([send(STRANGER)])

    await rejects(() => clearSignTransaction(chain, new Uint8Array([1, 2, 3])), 'INVALID_INPUT', isCryptoError)
    await rejects(() => clearSignTransaction(chain, {message: message.subarray(0, 40)}), 'INVALID_INPUT', isCryptoError)
    await rejects(() => clearSignTransaction(chain, {message: Uint8Array.from([...message, 0])}), 'INVALID_INPUT')
    await rejects(() => clearSignTransaction(chain, new Uint8Array()), 'INVALID_INPUT')
  })

  test('errors: a message version after v0 is UNSUPPORTED', async () => {
    const message = compile([send(STRANGER)], {version: 0})
    const v1 = Uint8Array.from([0x81, ...message.subarray(1)])

    await rejects(() => clearSignTransaction(chain, {message: v1}), 'UNSUPPORTED', isCryptoError)
    await rejects(
      () =>
        clearSignTransaction(
          chain,
          wire(message).map((byte, index) => (index === 65 ? 0x81 : byte))
        ),
      'UNSUPPORTED'
    )
  })

  test('errors: a signer the transaction does not name, and options out of range, are INVALID_ARGUMENT', async () => {
    const message = compile([send(STRANGER)])

    await rejects(() => clearSignTransaction(chain, {message}, {signer: STRANGER}), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction(chain, {message}, {signer: 'not an address'}), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction(chain, {message}, {highPriorityFee: -1n}), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction(chain, {message}, {highPriorityFee: 5 as never}), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction(chain, {message}, {builtinTokens: 'yes' as never}), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction(chain, 'bytes' as never), 'INVALID_ARGUMENT')
    await rejects(() => clearSignTransaction({...chain, cluster: 'localnet' as never}, {message}), 'INVALID_ARGUMENT')
  })

  test('messages never quote the payload', async () => {
    await assert.rejects(
      () => clearSignTransaction(chain, {message: compile([send(STRANGER)])}, {signer: STRANGER}),
      error => !(error as Error).message.includes(STRANGER)
    )
  })

  test('the descriptor resolver is asked once per program, whatever the number of its instructions', async () => {
    let asked = 0
    await clear([raw(PROGRAM, [], [1]), raw(PROGRAM, [], [2])], {
      resolvers: {
        descriptors: {
          descriptor: () => {
            asked += 1

            return undefined
          },
        },
      },
    })

    assert.equal(asked, 1)
  })

  test('plainText reads the whole review', async () => {
    const text = plainText(await clear([send(STRANGER, 1_500_000_000n)]))

    assert.match(text, /^Send: Send 1\.5 SOL to /)
    assert.match(text, /Fee: 0\.000005 SOL/)
    assert.match(text, /UNKNOWN_DESTINATION, in action 1, about Recipient/)
  })
})
