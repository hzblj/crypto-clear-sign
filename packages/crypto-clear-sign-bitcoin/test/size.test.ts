// The size a fee rate divides by: exact when every input is signed and the adapter finalizes the transaction, else
// estimated from the inputs' scripts, as the adapter estimates its own. Inputs of every script the estimate knows,
// signed by @scure/btc-signer with keys of its own (so its finalized size is the independent measure).

import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {type ClearSigning, findField} from '@hzblj/crypto-clear-sign'
import {p2pk, p2pkh, p2sh, p2tr, p2wpkh, p2wsh, Transaction} from '@scure/btc-signer'
import {pubECDSA, pubSchnorr} from '@scure/btc-signer/utils.js'

import {BITCOIN_TEXTS, clearSignPsbt} from '../src'
import {chain, field, fromHex, only, previousTransaction, privateKey} from './support'

type Kind = 'p2pkh' | 'p2shP2wpkh' | 'p2sh' | 'p2wpkh' | 'p2tr' | 'p2wsh'

const VALUE = 50_000n
const PAID = 10_000n

/** Each input's weight once signed, as the adapter estimates it: 41 bytes of outpoint, script length and sequence, and
 * the signature data (P2PKH's script, P2SH-P2WPKH's push of its redeem script and its witness, a witness). */
const INPUT_WEIGHT: Partial<Record<Kind, number>> = {
  p2pkh: (41 + 107) * 4,
  p2shP2wpkh: (41 + 23) * 4 + 108,
  p2tr: 41 * 4 + 66,
  p2wpkh: 41 * 4 + 108,
}

const WITNESS: Partial<Record<Kind, boolean>> = {p2pkh: false, p2shP2wpkh: true, p2tr: true, p2wpkh: true}

/** A transaction of these inputs (each its own key) and one P2WPKH output, by BIP-144's rules. */
const expectedVsize = (kinds: readonly Kind[]) => {
  const witness = kinds.some(kind => WITNESS[kind])
  const legacy = kinds.filter(kind => !WITNESS[kind]).length
  const overhead = (4 + 1 + 1 + 4) * 4 + (witness ? 2 + legacy : 0)
  const output = (8 + 1 + 22) * 4

  return Math.ceil((overhead + output + kinds.reduce((sum, kind) => sum + (INPUT_WEIGHT[kind] ?? 0), 0)) / 4)
}

const payment = (kind: Kind, key: Uint8Array) => {
  switch (kind) {
    case 'p2pkh':
      return p2pkh(pubECDSA(key))
    case 'p2shP2wpkh':
      return p2sh(p2wpkh(pubECDSA(key)))
    case 'p2sh':
      return p2sh(p2pk(pubECDSA(key)))
    case 'p2tr':
      return p2tr(pubSchnorr(key))
    case 'p2wsh':
      return p2wsh(p2pk(pubECDSA(key)))
    default:
      return p2wpkh(pubECDSA(key))
  }
}

/**
 * A transaction spending one coin of each kind (key `index + 1`) to one P2WPKH output: unsigned, and the transaction
 * itself, to sign. Keys are named (a BIP-32 origin) for the ECDSA kinds: the estimate takes a P2SH coin with one key
 * named as P2SH-P2WPKH, and `named: false` leaves that out.
 */
const build = (kinds: readonly Kind[], {named = true, paid = PAID}: {named?: boolean; paid?: bigint} = {}) => {
  const tx = new Transaction({allowLegacyWitnessUtxo: true})

  for (const [index, kind] of kinds.entries()) {
    const key = privateKey(index + 1)
    const pay = payment(kind, key)
    const previous = previousTransaction(pay.script, VALUE, 0, index + 1)
    tx.addInput({
      index: 0,
      txid: fromHex(previous.txid),
      ...(kind === 'p2pkh' || kind === 'p2sh'
        ? {nonWitnessUtxo: previous.raw}
        : {witnessUtxo: {amount: VALUE, script: pay.script}}),
      ...('redeemScript' in pay ? {redeemScript: pay.redeemScript} : {}),
      ...('witnessScript' in pay ? {witnessScript: pay.witnessScript} : {}),
      ...(kind === 'p2tr'
        ? {tapInternalKey: pubSchnorr(key)}
        : named
          ? {bip32Derivation: [[pubECDSA(key), {fingerprint: 1, path: [0]}]]}
          : {}),
    })
  }

  tx.addOutput({amount: paid, script: p2wpkh(pubECDSA(privateKey(99))).script})

  return tx
}

const signAll = (tx: Transaction, kinds: readonly Kind[]) => {
  for (const index of kinds.keys()) {
    tx.signIdx(privateKey(index + 1), index)
  }
}

const sizeOf = (result: ClearSigning) => {
  const size = field(result, 'size')
  assert.ok(size.kind === 'number')

  return {estimated: size.label.code === BITCOIN_TEXTS.label.estimatedSize.code, vsize: Number(size.value)}
}

const rateOf = (result: ClearSigning) => {
  const rate = field(result, 'feeRate')
  assert.ok(rate.kind === 'number')

  return Number(rate.value)
}

describe('size estimates, and the fee rates they give', () => {
  test('P2PKH and P2SH-P2WPKH: 148 and 91 vB an input, at or above the size btc-signer signs them to', async () => {
    for (const kinds of [['p2pkh'], ['p2shP2wpkh'], ['p2pkh', 'p2pkh'], ['p2shP2wpkh', 'p2wpkh']] as Kind[][]) {
      const tx = build(kinds)
      const result = await clearSignPsbt(chain, tx.toPSBT(0))
      const size = sizeOf(result)
      assert.deepEqual(size, {estimated: true, vsize: expectedVsize(kinds)}, kinds.join('+'))
      const fee = BigInt(kinds.length) * VALUE - PAID
      assert.equal(rateOf(result), Math.round((Number(fee) / size.vsize) * 100) / 100)

      signAll(tx, kinds)
      tx.finalize()
      assert.ok(size.vsize >= tx.vsize && size.vsize <= tx.vsize + kinds.length, `${kinds.join('+')}: ${tx.vsize}`)
    }

    // One P2PKH input and one P2WPKH output: 10 + 148 + 31 bytes, no witness.
    assert.equal(expectedVsize(['p2pkh']), 189)
  })

  test('legacy and SegWit inputs together: each legacy input carries an empty witness (BIP-144)', async () => {
    // 42 + 124 + 592 + 592 + 230 = 1,580 weight units without the two empty witnesses (395 vB, as estimated before),
    // 1,582 with them: 396 vB, as large as the transaction can be signed.
    const kinds: Kind[] = ['p2pkh', 'p2pkh', 'p2tr']
    const tx = build(kinds)
    const result = await clearSignPsbt(chain, tx.toPSBT(0))
    assert.deepEqual(sizeOf(result), {estimated: true, vsize: 396})
    signAll(tx, kinds)
    tx.finalize()
    assert.ok(tx.vsize <= 396)

    for (const mixed of [
      ['p2pkh', 'p2wpkh'],
      ['p2shP2wpkh', 'p2pkh'],
      ['p2wpkh', 'p2pkh', 'p2tr'],
    ] as Kind[][]) {
      const signed = build(mixed)
      const estimated = sizeOf(await clearSignPsbt(chain, signed.toPSBT(0)))
      assert.equal(estimated.vsize, expectedVsize(mixed), mixed.join('+'))
      signAll(signed, mixed)
      signed.finalize()
      assert.ok(estimated.vsize >= signed.vsize, `${mixed.join('+')}: ${signed.vsize}`)
    }
  })

  test('an input the estimate cannot size leaves the size and the fee rate out; the fee still shows', async () => {
    // P2WSH: its witness depends on a script the coin does not show. P2SH without a key named: not taken as P2WPKH.
    for (const [kinds, named] of [
      [['p2wsh'], true],
      [['p2wpkh', 'p2wsh'], true],
      [['p2shP2wpkh'], false],
    ] as const) {
      const result = await clearSignPsbt(chain, build(kinds, {named}).toPSBT(0))
      assert.equal(findField(result, 'size'), undefined, kinds.join('+'))
      assert.equal(findField(result, 'feeRate'), undefined)
      const fee = field(result, 'fee')
      assert.ok(fee.kind === 'amount' && fee.value === BigInt(kinds.length) * VALUE - PAID)
      // A fee the rate cannot judge is still judged by its share of what is sent.
      assert.deepEqual(only(result, 'HIGH_FEE').fields, ['fee'])
    }

    // The near case: the same P2SH-P2WPKH coin with its key named is estimated.
    assert.equal(sizeOf(await clearSignPsbt(chain, build(['p2shP2wpkh']).toPSBT(0))).vsize, 133)
  })

  test('what the estimate cannot check: any P2SH coin with one key named is taken as P2SH-P2WPKH', async () => {
    // The adapter gives no redeem script, and the chain client hashes none, so a P2SH-P2PK coin passes for one. Its
    // signed size is larger: the rate shown is higher than the real one, never lower.
    const kinds: Kind[] = ['p2sh']
    const tx = build(kinds)
    const estimated = sizeOf(await clearSignPsbt(chain, tx.toPSBT(0)))
    assert.deepEqual(estimated, {estimated: true, vsize: expectedVsize(['p2shP2wpkh'])})
    signAll(tx, kinds)
    tx.finalize()
    assert.ok(tx.vsize > estimated.vsize, String(tx.vsize))
  })
})

describe('partly signed PSBTs', () => {
  const kinds: Kind[] = ['p2wpkh', 'p2wpkh']

  test('one input of two signed: the size is estimated, its fee rate from the estimate', async () => {
    const tx = build(kinds)
    tx.signIdx(privateKey(1), 0)
    const psbt = tx.toPSBT(0)
    assert.equal(chain.decodePsbt(psbt).inputs[0]?.partialSignatures.length, 1)

    const result = await clearSignPsbt(chain, psbt)
    assert.deepEqual(sizeOf(result), {estimated: true, vsize: expectedVsize(kinds)})
    assert.equal(rateOf(result), Math.round((90_000 / expectedVsize(kinds)) * 100) / 100)
  })

  test('every input signed, one with a signature of another transaction: finalizing fails, so estimated', async () => {
    // The second input's signature commits to a transaction paying 20,000 sats: valid DER, the wrong message.
    const elsewhere = build(kinds, {paid: 20_000n})
    elsewhere.signIdx(privateKey(2), 1)
    const tx = build(kinds)
    tx.signIdx(privateKey(1), 0)
    tx.updateInput(1, {partialSig: elsewhere.getInput(1).partialSig}, true)
    const psbt = tx.toPSBT(0)
    assert.ok(chain.decodePsbt(psbt).inputs.every(input => input.partialSignatures.length === 1))
    assert.throws(() => chain.finalizePsbt(psbt))

    const result = await clearSignPsbt(chain, psbt)
    assert.deepEqual(sizeOf(result), {estimated: true, vsize: expectedVsize(kinds)})
    assert.ok(findField(result, 'feeRate'))
  })

  test('every input signed and verified, one already finalized: the exact size, btc-signer`s', async () => {
    const tx = build(kinds)
    signAll(tx, kinds)
    tx.finalizeIdx(0)
    const psbt = tx.toPSBT(0)
    assert.equal(chain.decodePsbt(psbt).inputs[0]?.finalized, true)

    const result = await clearSignPsbt(chain, psbt)
    tx.finalizeIdx(1)
    assert.deepEqual(sizeOf(result), {estimated: false, vsize: tx.vsize})
    assert.equal(sizeOf(result).vsize, chain.finalizePsbt(psbt).vsize)
    // A low-R signature is a byte shorter than the estimate allows for: the exact size is below it.
    assert.ok(tx.vsize <= expectedVsize(kinds))
  })
})
