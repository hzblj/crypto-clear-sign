// Marketplace offers: a PSBT whose outputs ask for more than its inputs hold (a seller's coin and the asking price,
// signed SIGHASH_SINGLE|ANYONECANPAY, waiting for a buyer's inputs), which @hzblj/crypto-bitcoin 0.3.1 reads with a
// negative `balance` and no fee. Written by @scure/btc-signer, unsigned and signed, and completed by a buyer.

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {actionAt, type ClearSigning, findField, INTENTS, plainText} from '@hzblj/crypto-clear-sign'
import {p2tr, p2wpkh, SigHash, Transaction} from '@scure/btc-signer'
import {pubECDSA, pubSchnorr} from '@scure/btc-signer/utils.js'

import {BITCOIN_TEXTS, clearSignPsbt} from '../src'
import {
  btcSignerPsbt,
  chain,
  codes,
  field,
  fromHex,
  has,
  only,
  previousTransaction,
  privateKey,
  setup,
  sum,
} from './support'

const SINGLE_ACP = SigHash.SINGLE_ANYONECANPAY
const ALL_ACP = SigHash.ALL_ANYONECANPAY
const NONE_ACP = SigHash.NONE_ANYONECANPAY

const INSCRIPTION = `${'ab'.repeat(32)}i0`

const amountOf = (action: Parameters<typeof field>[0], id: string): bigint => {
  const found = field(action, id)
  assert.ok(found.kind === 'amount', `${id} is ${found.kind}`)

  return found.value
}

const intentOf = (result: ClearSigning, index: number) => actionAt(result, [index])?.intent.code

describe('clearSignPsbt: marketplace offers', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, receive, segwit, taproot} = accounts
  const options = {accounts: [...xpubAccounts]}

  /** The wallet's Taproot coin (an inscription's, say) for a price paid to its receiving address at the same index. */
  const listing = ({
    outputs = [{account: receive, value: 100_000n}],
    sighashType = SINGLE_ACP,
    value = 10_000n,
  }: {
    readonly outputs?: Parameters<typeof btcSignerPsbt>[1]
    readonly sighashType?: number
    readonly value?: bigint
  } = {}) => btcSignerPsbt([{account: taproot, sighashType, value}], outputs)

  const coinOf = (psbt: Uint8Array) => {
    const [input] = chain.decodePsbt(psbt).inputs
    assert.ok(input)

    return `${input.txid}:${input.vout}`
  }

  test('a listing: the coin and its inscription given, the price asked, nothing about a fee', async () => {
    const psbt = listing()
    assert.equal(chain.decodePsbt(psbt).balance, -90_000n)
    const result = await clearSignPsbt(chain, psbt, {
      ...options,
      assets: {[coinOf(psbt)]: {inscriptions: [{id: INSCRIPTION, offset: 0}]}},
    })

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.offer.code)
    assert.equal(result.summary?.code, BITCOIN_TEXTS.summary.offerAssets.code)
    assert.deepEqual(result.summary?.params, {asked: '0.001 BTC', given: '0.0001 BTC'})

    // What the signer gives, what it asks in return, and what the buyer has to put in.
    assert.equal(amountOf(result, 'yourCoins'), 10_000n)
    const inscriptions = field(result, 'inscriptions')
    assert.ok(inscriptions.kind === 'number' && inscriptions.value === 1)
    assert.equal(findField(result, 'runes'), undefined)
    assert.equal(amountOf(result, 'inReturn'), 100_000n)
    assert.equal(amountOf(result, 'unfunded'), 90_000n)
    assert.equal(field(result, 'unfunded').secondary, true)

    // No fee yet: none shown, and nothing judged.
    for (const id of ['amount', 'fee', 'feeRate', 'net']) {
      assert.equal(findField(result, id), undefined, id)
    }
    assert.equal(field(result, 'size').label.code, BITCOIN_TEXTS.label.estimatedSize.code)

    // The price, at the coin's index, is what it receives.
    const price = actionAt(result, [0])
    assert.ok(price)
    assert.equal(price.intent.code, BITCOIN_TEXTS.intent.receive.code)
    assert.deepEqual(price.summary?.params, {amount: '0.001 BTC'})
    const to = field(price, 'to')
    assert.ok(to.kind === 'address' && to.relation === 'self' && to.value === receive.address)

    // The signature explained, and the inscription leaving with whoever completes it.
    assert.deepEqual(codes(result), ['ASSET_OWNERSHIP_TRANSFER', 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY'])
    const offer = only(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY')
    assert.deepEqual(
      [offer.severity, offer.action, offer.fields, offer.params],
      ['high', [], ['input-0-sighash'], {input: 0, output: 0}]
    )
    const leaving = only(result, 'ASSET_OWNERSHIP_TRANSFER')
    assert.deepEqual(
      [leaving.severity, leaving.action, leaving.fields, leaving.params],
      ['critical', [], ['input-0', 'input-0-sighash'], {input: 0}]
    )
    assert.equal(result.risk, 'critical')

    const text = plainText(result)
    assert.match(text, /^Offer: Offer 0\.0001 BTC and the inscriptions or runes it holds for 0\.001 BTC\n/)
    assert.match(text, /In return: 0\.001 BTC/)
    assert.match(text, /Receive: Receive 0\.001 BTC in return/)
  })

  test('a coin alone says so; one holding runes counts them', async () => {
    const psbt = listing()
    const plain = await clearSignPsbt(chain, psbt, options)
    assert.equal(plain.summary?.code, BITCOIN_TEXTS.summary.offer.code)
    assert.deepEqual(plain.summary?.params, {asked: '0.001 BTC', given: '0.0001 BTC'})
    assert.equal(findField(plain, 'inscriptions'), undefined)
    assert.deepEqual(codes(plain), ['bitcoin.SIGHASH_SINGLE_ANYONECANPAY'])
    assert.equal(plain.risk, 'high')

    const runes = await clearSignPsbt(chain, psbt, {
      ...options,
      assets: {[coinOf(psbt)]: {runes: [{amount: 1_000n, id: '840000:3'}]}},
    })
    assert.equal(runes.summary?.code, BITCOIN_TEXTS.summary.offerAssets.code)
    const held = field(runes, 'runes')
    assert.ok(held.kind === 'number' && held.value === 1)
    assert.equal(only(runes, 'ASSET_OWNERSHIP_TRANSFER').severity, 'critical')
  })

  test('no fee to judge, however low the limits; a listing within its coin`s value has one', async () => {
    const strict = {...options, maxFee: 0n, maxFeePercent: 0.01, maxFeeRate: 0.01}
    const unfinished = await clearSignPsbt(chain, listing(), strict)
    assert.equal(has(unfinished, 'HIGH_FEE'), false)
    assert.equal(has(unfinished, 'bitcoin.UNKNOWN_FEE'), false)

    // The near case: a coin worth more than its price. That transaction is finished, and the rest is its fee.
    const finished = await clearSignPsbt(chain, listing({value: 150_000n}), strict)
    assert.equal(finished.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.equal(amountOf(finished, 'fee'), 50_000n)
    assert.equal(findField(finished, 'inReturn'), undefined)
    assert.equal(findField(finished, 'yourCoins'), undefined)
    // Its signature leaves it open, so the fee is a draft's and not judged either; the price is still what it asks.
    assert.equal(has(finished, 'HIGH_FEE'), false)
    assert.equal(intentOf(finished, 0), BITCOIN_TEXTS.intent.receive.code)
  })

  test('in return is the signer`s own output: a stranger`s paired output asks nothing', async () => {
    const psbt = listing({outputs: [{account: other, noOrigin: true, value: 100_000n}]})
    const stranger = await clearSignPsbt(chain, psbt, options)
    assert.equal(stranger.intent.code, BITCOIN_TEXTS.intent.offer.code)
    assert.equal(stranger.summary?.code, BITCOIN_TEXTS.summary.offerNothing.code)
    assert.deepEqual(stranger.summary?.params, {given: '0.0001 BTC'})
    assert.equal(amountOf(stranger, 'inReturn'), 0n)
    assert.equal(intentOf(stranger, 0), INTENTS.send.code)
    assert.deepEqual(only(stranger, 'UNKNOWN_DESTINATION').action, [0])

    // Without accounts nothing is anyone's: the output its signature pairs is what it asks, whoever it pays.
    const blind = await clearSignPsbt(chain, psbt)
    assert.equal(blind.summary?.code, BITCOIN_TEXTS.summary.offer.code)
    assert.equal(amountOf(blind, 'inReturn'), 100_000n)
    assert.equal(amountOf(blind, 'yourCoins'), 10_000n)
    assert.equal(intentOf(blind, 0), INTENTS.send.code)
  })

  test('ALL|ANYONECANPAY fixes every output: the signer`s are asked; NONE|ANYONECANPAY asks nothing', async () => {
    const all = await clearSignPsbt(
      chain,
      listing({
        outputs: [
          {account: change, value: 5_000n},
          {account: other, noOrigin: true, value: 100_000n},
        ],
        sighashType: ALL_ACP,
      }),
      options
    )
    assert.equal(all.intent.code, BITCOIN_TEXTS.intent.offer.code)
    assert.deepEqual(all.summary?.params, {asked: '0.00005 BTC', given: '0.0001 BTC'})
    assert.equal(amountOf(all, 'unfunded'), 95_000n)
    assert.deepEqual([intentOf(all, 0), intentOf(all, 1)], [BITCOIN_TEXTS.intent.receive.code, INTENTS.send.code])
    assert.equal(only(all, 'bitcoin.SIGHASH_ANYONECANPAY').severity, 'medium')

    const none = await clearSignPsbt(chain, listing({sighashType: NONE_ACP}), options)
    assert.equal(none.summary?.code, BITCOIN_TEXTS.summary.offerNothing.code)
    assert.equal(amountOf(none, 'inReturn'), 0n)
    assert.equal(intentOf(none, 0), BITCOIN_TEXTS.intent.selfTransfer.code)
    assert.equal(only(none, 'bitcoin.SIGHASH_NONE').severity, 'critical')
    assert.equal(none.risk, 'critical')
  })

  test('several listings in one PSBT, beside a draft output nobody signs for', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: taproot, sighashType: SINGLE_ACP, value: 10_000n},
        {account: segwit, previous: true, sighashType: SINGLE_ACP, value: 20_000n},
      ],
      [
        {account: receive, value: 100_000n},
        {account: change, value: 200_000n},
        {account: other, noOrigin: true, value: 5_000n},
      ]
    )
    const result = await clearSignPsbt(chain, psbt, options)

    assert.deepEqual(result.summary?.params, {asked: '0.003 BTC', given: '0.0003 BTC'})
    assert.equal(amountOf(result, 'yourCoins'), 30_000n)
    assert.equal(amountOf(result, 'inReturn'), 300_000n)
    assert.equal(amountOf(result, 'unfunded'), 275_000n)
    assert.equal(findField(result, 'amount'), undefined)
    assert.deepEqual(
      [0, 1, 2].map(index => intentOf(result, index)),
      [BITCOIN_TEXTS.intent.receive.code, BITCOIN_TEXTS.intent.receive.code, INTENTS.send.code]
    )
    assert.deepEqual(
      result.warnings
        .filter(entry => entry.code === 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY')
        .map(entry => [entry.fields, entry.params]),
      [
        [['input-0-sighash'], {input: 0, output: 0}],
        [['input-1-sighash'], {input: 1, output: 1}],
      ]
    )
  })

  test('a coin without its value: the fee is unknown, as before, and nothing is called an offer', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: taproot, sighashType: SINGLE_ACP, value: 10_000n},
        {account: segwit, noUtxo: true, value: 5_000n},
      ],
      [{account: receive, value: 100_000n}]
    )
    assert.equal(chain.decodePsbt(psbt).balance, undefined)
    const result = await clearSignPsbt(chain, psbt, options)

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(only(result, 'bitcoin.UNKNOWN_FEE').fields, ['input-1'])
    assert.equal(findField(result, 'inReturn'), undefined)
  })

  test('someone else`s listing: none of it is the signer`s to sign', async () => {
    const result = await clearSignPsbt(chain, listing(), {accounts: [other]})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(result.summary?.params, {count: 0, total: 1})
    assert.equal(only(result, 'bitcoin.NO_OWN_INPUTS').severity, 'medium')
    assert.equal(has(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY'), false)
    for (const id of ['amount', 'yourCoins', 'inReturn', 'fee']) {
      assert.equal(findField(result, id), undefined, id)
    }
    assert.equal(intentOf(result, 0), INTENTS.send.code)
  })
})

describe('clearSignPsbt: an offer signed by btc-signer, then completed by a buyer', async () => {
  // The seller's inscription coin (Taproot) and payment address; the buyer's funds and the address for the inscription.
  const sellerKey = privateKey(1)
  const buyerKey = privateKey(3)
  const sellerCoin = p2tr(pubSchnorr(sellerKey))
  const sellerPay = p2wpkh(pubECDSA(privateKey(2)))
  const buyerFunds = p2wpkh(pubECDSA(buyerKey))
  const buyerOrdinals = p2tr(pubSchnorr(privateKey(4)))
  const seller = {
    accounts: [
      {addressType: 'p2tr' as const, scriptPubKey: sellerCoin.script},
      {addressType: 'p2wpkh' as const, scriptPubKey: sellerPay.script},
    ],
  }
  const buyer = {
    accounts: [
      {addressType: 'p2wpkh' as const, scriptPubKey: buyerFunds.script},
      {addressType: 'p2tr' as const, scriptPubKey: buyerOrdinals.script},
    ],
  }

  const coin = previousTransaction(sellerCoin.script, 10_000n, 0, 7)
  const assets = {[`${coin.txid}:0`]: {inscriptions: [{id: INSCRIPTION, offset: 0}]}}

  // The seller lists: its coin at index 0, the price at index 0, signed SINGLE|ANYONECANPAY.
  const offer = new Transaction()
  offer.addInput({
    index: 0,
    sighashType: SINGLE_ACP,
    tapInternalKey: pubSchnorr(sellerKey),
    txid: fromHex(coin.txid),
    witnessUtxo: {amount: 10_000n, script: sellerCoin.script},
  })
  offer.addOutput({amount: 100_000n, script: sellerPay.script})
  offer.signIdx(sellerKey, 0, [SINGLE_ACP])
  const signedOffer = offer.toPSBT(0)

  // The buyer completes it as marketplaces do: two dummy coins first, so the inscription's sat lands in the buyer's
  // output 1; the seller's signed input and its price move to index 2 together (ANYONECANPAY commits to no index).
  const listed = Transaction.fromPSBT(signedOffer)
  const price = listed.getOutput(0)
  const bought = new Transaction()
  const outputs = [
    {amount: 1_200n, script: buyerFunds.script},
    {amount: 10_000n, script: buyerOrdinals.script},
    {amount: price.amount ?? 0n, script: price.script ?? new Uint8Array()},
    {amount: 98_000n, script: buyerFunds.script},
  ]
  for (const output of outputs) {
    bought.addOutput(output)
  }
  const funds = [600n, 600n, 0n, 200_000n]
  for (const [index, value] of funds.entries()) {
    if (index === 2) {
      bought.addInput(listed.getInput(0))
      continue
    }
    const previous = previousTransaction(buyerFunds.script, value, 0, 20 + index)
    bought.addInput({index: 0, txid: fromHex(previous.txid), witnessUtxo: {amount: value, script: buyerFunds.script}})
  }
  for (const index of [0, 1, 3]) {
    bought.signIdx(buyerKey, index)
  }
  const completed = bought.toPSBT(0)
  bought.finalize()
  const fee = 10_000n + sum(funds) - sum(outputs.map(output => output.amount))

  test('signed, it is still an offer: its signature is there, and the size is estimated', async () => {
    const decoded = chain.decodePsbt(signedOffer)
    assert.ok(decoded.inputs[0]?.taprootKeySignature)
    assert.equal(decoded.balance, -90_000n)

    const result = await clearSignPsbt(chain, signedOffer, {...seller, assets})
    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.offer.code)
    assert.deepEqual(result.summary?.params, {asked: '0.001 BTC', given: '0.0001 BTC'})
    assert.equal(field(result, 'size').label.code, BITCOIN_TEXTS.label.estimatedSize.code)
    assert.equal(intentOf(result, 0), BITCOIN_TEXTS.intent.receive.code)
    assert.deepEqual(codes(result), ['ASSET_OWNERSHIP_TRANSFER', 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY'])
  })

  test('completed, it is a shared transaction with a fee, finalized at btc-signer`s size', async () => {
    assert.equal(chain.decodePsbt(completed).fee, fee)
    const result = await clearSignPsbt(chain, completed, {...seller, assets, maxFeeRate: 1})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(result.summary?.params, {count: 1, total: 4})
    assert.equal(amountOf(result, 'fee'), fee)
    const size = field(result, 'size')
    assert.ok(size.kind === 'number' && size.label.code === BITCOIN_TEXTS.label.size.code)
    assert.equal(size.value, bought.vsize)
    for (const id of ['inReturn', 'unfunded']) {
      assert.equal(findField(result, id), undefined, id)
    }

    // What the seller puts in and gets back.
    assert.equal(amountOf(result, 'yourCoins'), 10_000n)
    assert.equal(amountOf(result, 'backToYou'), 100_000n)
    assert.equal(field(result, 'net').label.code, BITCOIN_TEXTS.label.youReceive.code)
    assert.equal(amountOf(result, 'net'), 90_000n)
    assert.equal(intentOf(result, 2), BITCOIN_TEXTS.intent.receive.code)

    // The seller's signature, now at index 2, is explained there; the fee is not the seller's to judge.
    assert.deepEqual(only(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY').params, {input: 2, output: 2})
    assert.deepEqual(only(result, 'ASSET_OWNERSHIP_TRANSFER').fields, ['input-2', 'input-2-sighash'])
    assert.deepEqual(only(result, 'bitcoin.FOREIGN_INPUTS').fields, ['input-0', 'input-1', 'input-3'])
    assert.equal(has(result, 'HIGH_FEE'), false)
  })

  test('the buyer`s view: its own coins and outputs, and a fee it signs for, so judged', async () => {
    const result = await clearSignPsbt(chain, completed, buyer)

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(result.summary?.params, {count: 3, total: 4})
    assert.equal(amountOf(result, 'amount'), 100_000n)
    assert.equal(field(result, 'net').label.code, BITCOIN_TEXTS.label.youPay.code)
    assert.equal(amountOf(result, 'net'), 201_200n - 109_200n)
    assert.equal(intentOf(result, 2), INTENTS.send.code)
    // The seller's signature type is shown on its input, not warned of: it is not the buyer's.
    assert.equal(has(result, 'bitcoin.SIGHASH_SINGLE_ANYONECANPAY'), false)
    const sighash = field(result, 'input-2-sighash')
    assert.ok(sighash.kind === 'text' && sighash.value === 'SINGLE|ANYONECANPAY')
    assert.equal(has(result, 'HIGH_FEE'), false)

    const strict = await clearSignPsbt(chain, completed, {...buyer, maxFeeRate: 1})
    assert.deepEqual(only(strict, 'HIGH_FEE').fields, ['fee', 'feeRate'])
  })
})
