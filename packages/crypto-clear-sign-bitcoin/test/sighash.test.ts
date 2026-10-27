import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {findField} from '@hzblj/crypto-clear-sign'

import {BITCOIN_TEXTS, type BitcoinWarningCode, clearSignPsbt} from '../src'
import {btcSignerPsbt, chain, codes, field, has, only, setup} from './support'

const ALL = 0x01
const NONE = 0x02
const SINGLE = 0x03
const ACP = 0x80

const SIGHASH_CODES: readonly BitcoinWarningCode[] = [
  'bitcoin.SIGHASH_ANYONECANPAY',
  'bitcoin.SIGHASH_NONE',
  'bitcoin.SIGHASH_SINGLE',
  'bitcoin.SIGHASH_SINGLE_ANYONECANPAY',
  'bitcoin.UNUSUAL_SIGHASH',
]

describe('signature hash types', async () => {
  const {accounts, strangerFingerprint, xpubAccounts} = await setup()
  const {change, other, segwit, taproot} = accounts

  /** One input of `account` with `sighashType`, and two outputs: a payment and change. */
  const read = (account: typeof segwit, sighashType: number | undefined, options = {}) =>
    clearSignPsbt(
      chain,
      btcSignerPsbt(
        [{account, previous: true, sighashType, value: 100_000n}],
        [
          {account: other, noOrigin: true, value: 50_000n},
          {account: change, value: 49_000n},
        ]
      ),
      {accounts: [...xpubAccounts], ...options}
    )

  const sighashWarnings = (result: Awaited<ReturnType<typeof read>>) =>
    result.warnings.filter(entry => SIGHASH_CODES.includes(entry.code as BitcoinWarningCode))

  for (const [name, account] of [
    ['P2WPKH', segwit],
    ['Taproot', taproot],
  ] as const) {
    test(`${name}: unstated and ALL commit to everything, and warn of nothing`, async () => {
      const unstated = await read(account, undefined)
      assert.deepEqual(sighashWarnings(unstated), [])
      assert.equal(findField(unstated, 'input-0-sighash'), undefined)

      const all = await read(account, ALL)
      assert.deepEqual(sighashWarnings(all), [])
      const shown = field(all, 'input-0-sighash')
      assert.ok(shown.kind === 'text')
      assert.deepEqual([shown.value, shown.secondary], ['ALL', true])
    })

    test(`${name}: NONE and NONE|ANYONECANPAY are critical, the outputs can be replaced`, async () => {
      for (const type of [NONE, NONE | ACP]) {
        const result = await read(account, type)
        const warning = only(result, 'bitcoin.SIGHASH_NONE')
        assert.equal(warning.severity, 'critical')
        assert.deepEqual(warning.action, [])
        assert.deepEqual(warning.fields, ['input-0-sighash'])
        assert.deepEqual(warning.params, {input: 0})
        assert.equal(result.risk, 'critical')
        const shown = field(result, 'input-0-sighash')
        assert.ok(shown.kind === 'text' && shown.secondary !== true)
        assert.equal(shown.value, type === NONE ? 'NONE' : 'NONE|ANYONECANPAY')
      }
    })

    test(`${name}: SINGLE is high, naming the one output it covers`, async () => {
      const result = await read(account, SINGLE)
      const warning = only(result, 'bitcoin.SIGHASH_SINGLE')
      assert.equal(warning.severity, 'high')
      assert.deepEqual(warning.params, {input: 0, output: 0})
      assert.equal(has(result, 'bitcoin.SIGHASH_ANYONECANPAY'), false)
    })

    test(`${name}: SINGLE|ANYONECANPAY is an offer, high`, async () => {
      const result = await read(account, SINGLE | ACP)
      const warning = only(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY')
      assert.equal(warning.severity, 'high')
      assert.deepEqual(warning.params, {input: 0, output: 0})
      assert.equal(sighashWarnings(result).length, 1)
      assert.match(warning.message, /Marketplaces/)
    })

    test(`${name}: ALL|ANYONECANPAY lets others add inputs, medium`, async () => {
      const result = await read(account, ALL | ACP)
      const warning = only(result, 'bitcoin.SIGHASH_ANYONECANPAY')
      assert.equal(warning.severity, 'medium')
      assert.deepEqual(warning.params, {input: 0})
      assert.equal(sighashWarnings(result).length, 1)
    })

    test(`${name}: a type no wallet uses is unusual, high`, async () => {
      const result = await read(account, 0x04)
      const warning = only(result, 'bitcoin.UNUSUAL_SIGHASH')
      assert.equal(warning.severity, 'high')
      assert.deepEqual(warning.params, {input: 0, type: '0x04'})
    })
  }

  test('a signature left open is part of a transaction, and its draft fee is not judged', async () => {
    // A listing: the seller's coin for a price paid at the same index; the buyer's inputs and outputs come later.
    const listing = (sighashType?: number) =>
      clearSignPsbt(
        chain,
        btcSignerPsbt(
          [{account: taproot, sighashType, value: 150_000n}],
          [{account: accounts.receive, value: 100_000n}]
        ),
        {accounts: [...xpubAccounts]}
      )

    const offer = await listing(SINGLE | ACP)
    assert.equal(offer.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(offer.summary?.params, {count: 1, total: 1})
    assert.equal(has(offer, 'HIGH_FEE'), false)

    const whole = await listing(undefined)
    assert.equal(whole.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)
    assert.equal(has(whole, 'HIGH_FEE'), true)
  })

  test('Taproot`s DEFAULT is ALL; for a P2WPKH coin, type 0 is no type at all', async () => {
    const taprootDefault = await read(taproot, 0)
    assert.deepEqual(sighashWarnings(taprootDefault), [])
    const shown = field(taprootDefault, 'input-0-sighash')
    assert.ok(shown.kind === 'text' && shown.value === 'DEFAULT')

    const segwitZero = await read(segwit, 0)
    assert.deepEqual(only(segwitZero, 'bitcoin.UNUSUAL_SIGHASH').params, {input: 0, type: 'DEFAULT'})
  })

  test('SINGLE with no output at its index signs no output (SegWit v0), and cannot be signed (Taproot)', async () => {
    const lone = (account: typeof segwit) =>
      clearSignPsbt(
        chain,
        btcSignerPsbt(
          [
            {account: segwit, previous: true, value: 10_000n},
            {account, previous: true, sighashType: SINGLE, value: 20_000n},
          ],
          [{account: other, noOrigin: true, value: 29_000n}]
        ),
        {accounts: [...xpubAccounts]}
      )

    const segwitSingle = await lone(accounts.receive)
    const none = only(segwitSingle, 'bitcoin.SIGHASH_NONE')
    assert.deepEqual([none.params, none.fields], [{input: 1}, ['input-1-sighash']])

    const taprootSingle = await lone(taproot)
    assert.deepEqual(only(taprootSingle, 'bitcoin.UNUSUAL_SIGHASH').params, {input: 1, type: 'SINGLE'})
  })

  test('another wallet`s input: its signature type is shown, not warned of; without accounts, every input is', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: segwit, previous: true, value: 100_000n},
        {account: {...other, fingerprint: strangerFingerprint}, previous: true, sighashType: NONE, value: 10_000n},
      ],
      [
        {account: other, noOrigin: true, value: 60_000n},
        {account: change, value: 49_000n},
      ]
    )
    const signer = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    assert.equal(has(signer, 'bitcoin.SIGHASH_NONE'), false)
    const shown = field(signer, 'input-1-sighash')
    assert.ok(shown.kind === 'text' && shown.value === 'NONE')

    const nobody = await clearSignPsbt(chain, psbt)
    assert.deepEqual(only(nobody, 'bitcoin.SIGHASH_NONE').params, {input: 1})
  })

  test('ANYONECANPAY on the Taproot input: it no longer vouches for the P2WPKH coin`s value', async () => {
    const mixed = (sighashType?: number) =>
      clearSignPsbt(
        chain,
        btcSignerPsbt(
          [
            {account: segwit, value: 40_000n},
            {account: taproot, sighashType, value: 60_000n},
          ],
          [{account: other, noOrigin: true, value: 99_000n}]
        ),
        {accounts: [...xpubAccounts]}
      )

    assert.equal(has(await mixed(), 'bitcoin.UNVERIFIED_VALUES'), false)
    assert.equal(has(await mixed(ALL), 'bitcoin.UNVERIFIED_VALUES'), false)
    const anyone = await mixed(ALL | ACP)
    assert.deepEqual(only(anyone, 'bitcoin.UNVERIFIED_VALUES').fields, ['input-0-amount'])
    assert.deepEqual(codes(anyone), [
      'UNKNOWN_DESTINATION',
      'bitcoin.SIGHASH_ANYONECANPAY',
      'bitcoin.UNVERIFIED_VALUES',
    ])
  })
})
