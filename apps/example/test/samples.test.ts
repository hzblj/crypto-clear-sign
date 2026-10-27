import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type RiskLevel, warningsAt} from '@hzblj/crypto-clear-sign'

import {DEFAULT_SETTINGS} from '../src/core/options'
import {SAMPLES, sampleOf} from '../src/core/samples'
import {actionOf, codes, demo, field, OFFLINE, reviewed} from './support'

type Expected = {readonly risk: RiskLevel; readonly codes: readonly string[]}

/**
 * Every sample of the gallery, with the app's resolvers and the packages' built-in lists (what the tabs show by
 * default), and offline (Settings with both off): its risk and every warning code. The integration test of the four
 * packages, through the same `review` the app calls.
 */
const EXPECTED: Readonly<Record<string, {readonly resolved: Expected; readonly offline: Expected}>> = {
  'bip322-message': {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'blind-message': {
    offline: {codes: ['BLIND_SIGNING'], risk: 'high'},
    resolved: {codes: ['BLIND_SIGNING'], risk: 'high'},
  },
  cenotaph: {
    offline: {codes: ['UNKNOWN_DESTINATION', 'bitcoin.CENOTAPH'], risk: 'critical'},
    resolved: {codes: ['UNKNOWN_DESTINATION', 'bitcoin.CENOTAPH'], risk: 'critical'},
  },

  'close-account-stranger': {
    offline: {codes: ['solana.CLOSE_TO_OTHER'], risk: 'high'},
    resolved: {codes: ['solana.CLOSE_TO_OTHER'], risk: 'high'},
  },
  consolidation: {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'durable-nonce': {
    offline: {codes: ['UNKNOWN_DESTINATION', 'solana.DURABLE_NONCE'], risk: 'high'},
    resolved: {codes: ['UNKNOWN_DESTINATION', 'solana.DURABLE_NONCE'], risk: 'high'},
  },
  'eip2612-permit': {
    offline: {codes: ['LONG_LIVED', 'UNKNOWN_TOKEN', 'ethereum.UNKNOWN_SPENDER'], risk: 'high'},
    resolved: {codes: ['LONG_LIVED'], risk: 'medium'},
  },
  'eip7702-all-chains': {
    offline: {codes: ['ALL_CHAINS', 'ASSET_OWNERSHIP_TRANSFER'], risk: 'critical'},
    resolved: {codes: ['ALL_CHAINS', 'ASSET_OWNERSHIP_TRANSFER'], risk: 'critical'},
  },
  'eip7702-delegation': {
    offline: {codes: ['ASSET_OWNERSHIP_TRANSFER'], risk: 'critical'},
    resolved: {codes: ['ASSET_OWNERSHIP_TRANSFER'], risk: 'high'},
  },
  'high-fee': {
    offline: {codes: ['HIGH_FEE', 'UNKNOWN_DESTINATION'], risk: 'medium'},
    resolved: {codes: ['HIGH_FEE', 'UNKNOWN_DESTINATION'], risk: 'medium'},
  },
  'inscription-as-fee': {
    offline: {codes: ['ASSET_OWNERSHIP_TRANSFER', 'UNKNOWN_DESTINATION'], risk: 'critical'},
    resolved: {codes: ['ASSET_OWNERSHIP_TRANSFER', 'UNKNOWN_DESTINATION'], risk: 'critical'},
  },
  'jupiter-swap': {
    offline: {codes: ['UNKNOWN_CONTRACT_CALL'], risk: 'high'},
    resolved: {codes: ['UNKNOWN_CONTRACT_CALL'], risk: 'high'},
  },
  'native-transfer': {
    offline: {codes: ['UNKNOWN_DESTINATION'], risk: 'low'},
    resolved: {codes: [], risk: 'none'},
  },
  'offchain-message': {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'payment-with-change': {
    offline: {codes: ['UNKNOWN_DESTINATION'], risk: 'low'},
    resolved: {codes: [], risk: 'none'},
  },
  permit2: {
    offline: {codes: ['UNKNOWN_TOKEN', 'UNLIMITED_APPROVAL', 'ethereum.UNKNOWN_SPENDER'], risk: 'critical'},
    resolved: {codes: ['UNLIMITED_APPROVAL'], risk: 'critical'},
  },
  revoke: {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'runestone-transfer': {
    offline: {codes: ['UNKNOWN_DESTINATION', 'UNKNOWN_TOKEN'], risk: 'medium'},
    resolved: {codes: ['UNKNOWN_DESTINATION'], risk: 'low'},
  },
  'seaport-order': {
    offline: {codes: ['BLIND_SIGNING'], risk: 'high'},
    resolved: {codes: ['BLIND_SIGNING'], risk: 'high'},
  },
  'set-approval-for-all': {
    offline: {codes: ['ASSET_OWNERSHIP_TRANSFER', 'ethereum.UNKNOWN_SPENDER'], risk: 'critical'},
    resolved: {codes: ['ASSET_OWNERSHIP_TRANSFER', 'ethereum.UNKNOWN_SPENDER'], risk: 'critical'},
  },
  'set-authority-drainer': {
    offline: {
      codes: [
        'ASSET_OWNERSHIP_TRANSFER',
        'UNKNOWN_DESTINATION',
        'solana.CLOSE_TO_OTHER',
        'solana.NOT_FEE_PAYER',
        'solana.OTHER_SIGNERS',
      ],
      risk: 'critical',
    },
    resolved: {
      codes: [
        'ASSET_OWNERSHIP_TRANSFER',
        'UNKNOWN_DESTINATION',
        'solana.CLOSE_TO_OTHER',
        'solana.NOT_FEE_PAYER',
        'solana.OTHER_SIGNERS',
      ],
      risk: 'critical',
    },
  },
  'sighash-none': {
    offline: {codes: ['UNKNOWN_DESTINATION', 'bitcoin.SIGHASH_NONE'], risk: 'critical'},
    resolved: {codes: ['UNKNOWN_DESTINATION', 'bitcoin.SIGHASH_NONE'], risk: 'critical'},
  },
  'single-anyonecanpay': {
    offline: {codes: ['bitcoin.SIGHASH_SINGLE_ANYONECANPAY'], risk: 'high'},
    resolved: {codes: ['bitcoin.SIGHASH_SINGLE_ANYONECANPAY'], risk: 'high'},
  },
  siwe: {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'siwe-mismatch': {
    offline: {codes: ['ethereum.SIGN_IN_DOMAIN_MISMATCH'], risk: 'high'},
    resolved: {codes: ['ethereum.SIGN_IN_DOMAIN_MISMATCH'], risk: 'high'},
  },
  siws: {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'sol-transfer': {
    offline: {codes: ['UNKNOWN_DESTINATION'], risk: 'low'},
    resolved: {codes: [], risk: 'none'},
  },
  'spl-transfer-checked': {
    offline: {codes: ['UNKNOWN_DESTINATION', 'UNKNOWN_TOKEN'], risk: 'medium'},
    resolved: {codes: ['UNKNOWN_DESTINATION'], risk: 'low'},
  },
  'uniswap-swap': {
    offline: {codes: ['UNKNOWN_TOKEN', 'UNKNOWN_TOKEN'], risk: 'medium'},
    resolved: {codes: [], risk: 'none'},
  },
  'unknown-program': {
    offline: {codes: ['UNKNOWN_CONTRACT_CALL'], risk: 'high'},
    resolved: {codes: ['UNKNOWN_CONTRACT_CALL'], risk: 'high'},
  },
  'unknown-program-idl': {offline: {codes: [], risk: 'none'}, resolved: {codes: [], risk: 'none'}},
  'unlimited-approve': {
    offline: {codes: ['UNKNOWN_TOKEN', 'UNLIMITED_APPROVAL', 'ethereum.UNKNOWN_SPENDER'], risk: 'critical'},
    resolved: {codes: ['UNLIMITED_APPROVAL'], risk: 'critical'},
  },
  'usdc-transfer': {
    offline: {codes: ['UNKNOWN_DESTINATION', 'UNKNOWN_TOKEN'], risk: 'medium'},
    resolved: {codes: [], risk: 'none'},
  },
}

const sample = (chain: keyof typeof SAMPLES, id: string) => {
  const found = sampleOf(chain, id)
  assert.ok(found, `sample ${id}`)

  return found
}

describe('every sample, reviewed', () => {
  test('the gallery is what the tests expect, ids unique', () => {
    const ids = Object.values(SAMPLES).flatMap(list => list.map(entry => entry.id))
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual([...ids].sort(), Object.keys(EXPECTED).sort())
    assert.deepEqual(
      Object.entries(SAMPLES).map(([chain, list]) => [chain, list.length]),
      [
        ['bitcoin', 9],
        ['ethereum', 14],
        ['solana', 10],
      ]
    )
  })

  for (const [chain, list] of Object.entries(SAMPLES)) {
    for (const entry of list) {
      test(`${chain}: ${entry.id}, resolved and offline`, async () => {
        const expected = EXPECTED[entry.id]
        assert.ok(expected)
        assert.equal(entry.chain, chain)

        const {result: resolved} = await reviewed(entry)
        assert.equal(resolved.chain.family, chain)
        assert.deepEqual({codes: codes(resolved), risk: resolved.risk}, expected.resolved)

        const {result: offline} = await reviewed(entry, OFFLINE)
        assert.deepEqual({codes: codes(offline), risk: offline.risk}, expected.offline)
      })
    }
  }
})

describe('what the samples show', () => {
  test('an unlimited approval is unlimited, of USDC, to Permit2 by its built-in name', async () => {
    const {result} = await reviewed(sample('ethereum', 'unlimited-approve'))
    const amount = field(result, 'amount', 'amount')

    assert.equal(amount.unlimited, true)
    assert.equal(amount.symbol, 'USDC')
    assert.equal(field(result, 'spender', 'address').relation, 'contract')
    assert.deepEqual(result.source, {decoder: 'erc20', kind: 'builtin'})
    assert.equal(result.summary?.code, 'summary.approveUnlimited')
  })

  test('the Uniswap swap is the registry`s descriptor inside the built-in multicall', async () => {
    const {result} = await reviewed(sample('ethereum', 'uniswap-swap'))
    const swap = actionOf(result, 0)

    assert.deepEqual(result.source, {decoder: 'multicall', kind: 'builtin'})
    assert.equal(swap.source.kind, 'descriptor')
    assert.equal(swap.source.kind === 'descriptor' && swap.source.format, 'erc7730')
    assert.equal(field(result, 'deadline', 'datetime').expired, false)
  })

  test('the Seaport order is read by nothing: every member shown, blind', async () => {
    const {result} = await reviewed(sample('ethereum', 'seaport-order'))

    assert.equal(result.kind, 'typed-data')
    assert.equal(result.warnings[0]?.code, 'BLIND_SIGNING')
    assert.ok(result.fields.length > 3)
  })

  test('the EIP-2612 permit never ends, and Permit2`s 30 days are not long-lived', async () => {
    const permit = await reviewed(sample('ethereum', 'eip2612-permit'))
    const permit2 = await reviewed(sample('ethereum', 'permit2'))

    assert.equal(field(permit.result, 'deadline', 'datetime').never, true)
    assert.deepEqual(permit2.result.source, {decoder: 'permit2', kind: 'builtin'})
    assert.equal(field(permit2.result, 'expiration', 'datetime').never, false)
  })

  test('the type 4 transaction carries the signer`s own authorization as an action', async () => {
    const {result} = await reviewed(sample('ethereum', 'eip7702-delegation'))

    assert.equal(actionOf(result, 0).intent.code, 'intent.delegate')
    assert.deepEqual(result.warnings[0]?.action, [0])
  })

  test('the drainer is critical at its first instruction, and the attacker pays the fee', async () => {
    const {result} = await reviewed(sample('solana', 'set-authority-drainer'))

    assert.equal(result.warnings[0]?.code, 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual(result.warnings[0]?.action, [0])
    assert.equal(actionOf(result, 0).risk, 'critical')
    assert.equal(warningsAt(result, [1])[0]?.code, 'solana.CLOSE_TO_OTHER')
  })

  test('the aggregator swap is v0, its lookup table named, and only the router unread', async () => {
    const {result} = await reviewed(sample('solana', 'jupiter-swap'))

    assert.equal(field(result, 'version', 'text').value, 'v0')
    assert.deepEqual(result.warnings[0]?.action, [6])
    assert.equal(result.actions.length, 8)
  })

  test('the IDL reads what the unknown program could not', async () => {
    const bare = await reviewed(sample('solana', 'unknown-program'))
    const described = await reviewed(sample('solana', 'unknown-program-idl'))
    const action = actionOf(described.result, 0)

    assert.equal(actionOf(bare.result, 0).source.kind, 'unknown')
    assert.ok(actionOf(bare.result, 0).raw.length > 0)
    assert.deepEqual(action.source, {
      format: 'idl',
      id: 'demo-vault@0.1.0',
      kind: 'descriptor',
      publisher: 'Demo Vault',
    })
    assert.equal(action.intent.text, 'deposit')
  })

  test('change is the signer`s, verified by derivation; a consolidation pays only the signer', async () => {
    const payment = await reviewed(sample('bitcoin', 'payment-with-change'))
    const change = actionOf(payment.result, 1)
    const consolidation = await reviewed(sample('bitcoin', 'consolidation'))

    assert.equal(change.intent.code, 'bitcoin.intent.change')
    assert.equal(field(change, 'to', 'address').relation, 'self')
    assert.equal(consolidation.result.intent.code, 'bitcoin.intent.consolidate')
  })

  test('the inscription goes to the fee, and the runestone and cenotaph are read as ord reads them', async () => {
    const inscription = await reviewed(sample('bitcoin', 'inscription-as-fee'))
    const transfer = await reviewed(sample('bitcoin', 'runestone-transfer'))
    const cenotaph = await reviewed(sample('bitcoin', 'cenotaph'))

    assert.deepEqual(inscription.result.warnings[0]?.action, [])
    assert.equal(inscription.result.warnings[0]?.code, 'ASSET_OWNERSHIP_TRANSFER')
    assert.equal(actionOf(transfer.result, 2).intent.code, 'bitcoin.intent.runestone')
    assert.deepEqual(cenotaph.result.warnings[0]?.action, [2])
  })
})

describe('the settings', () => {
  test('without a signer nothing is self: the fee payer is an unknown address', async () => {
    const {result} = await reviewed(sample('solana', 'sol-transfer'), {...DEFAULT_SETTINGS, signers: {solana: ''}})

    assert.equal(field(result, 'feePayer', 'address').relation, 'unknown')
    assert.equal(result.risk, 'none')
  })

  test('another Ethereum signer: the sign-in request is for someone else`s account', async () => {
    const {accounts} = await demo()
    const {result} = await reviewed(sample('ethereum', 'siwe'), {
      ...DEFAULT_SETTINGS,
      signers: {ethereum: accounts.strangers.ethereum},
    })

    assert.deepEqual(codes(result), ['ethereum.SIGN_IN_ACCOUNT_MISMATCH'])
  })

  test('another Bitcoin signer: none of the coins are its own, and change is a payment like any other', async () => {
    const {accounts} = await demo()
    const {result} = await reviewed(sample('bitcoin', 'payment-with-change'), {
      ...DEFAULT_SETTINGS,
      signers: {bitcoin: accounts.strangers.bitcoin},
    })

    assert.equal(result.intent.code, 'bitcoin.intent.signPart')
    assert.equal(actionOf(result, 1).intent.code, 'intent.send')
    assert.deepEqual(codes(result), ['UNKNOWN_DESTINATION', 'bitcoin.NO_OWN_INPUTS'])
  })
})
