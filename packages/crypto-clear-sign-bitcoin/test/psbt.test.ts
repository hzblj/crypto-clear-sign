import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  actionAt,
  findField,
  INTENTS,
  isClearSignError,
  LABELS,
  plainText,
  SUMMARIES,
  WARNINGS,
  warningsAt,
} from '@hzblj/crypto-clear-sign'

import {BITCOIN_CHAIN_IDS, BITCOIN_TEXTS, BITCOIN_WARNINGS, clearSignPsbt} from '../src'
import {
  asyncResolvers,
  btcSignerPsbt,
  chain,
  codes,
  crypto,
  FINGERPRINT,
  field,
  has,
  only,
  opReturn,
  previousTransaction,
  rejectsWith,
  setup,
  utxo,
} from './support'

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

describe('clearSignPsbt: a payment from a P2WPKH account', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {other, segwit} = accounts
  const plan = segwit.createTransaction({amount: 25_000n, feeRate: 2, to: other.address, utxos: [utxo('aa', 100_000)]})
  const psbt = segwit.createPsbt(plan)

  test('says what it sends, to whom, and what it costs', async () => {
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.kind, 'psbt')
    assert.deepEqual(result.chain, {family: 'bitcoin', id: BITCOIN_CHAIN_IDS.mainnet, name: 'Bitcoin'})
    assert.deepEqual(result.source, {decoder: 'psbt', kind: 'builtin'})
    assert.equal(result.intent.code, INTENTS.send.code)
    assert.equal(result.summary?.code, SUMMARIES.send.code)
    assert.deepEqual(result.summary?.params, {amount: '0.00025 BTC', recipient: other.address})

    const amount = field(result, 'amount')
    assert.ok(amount.kind === 'amount')
    assert.equal(amount.value, 25_000n)
    assert.equal(amount.decimals, 8)
    assert.equal(amount.symbol, 'BTC')
    assert.equal(amount.baseUnit, 'sat')

    const fee = field(result, 'fee')
    assert.ok(fee.kind === 'amount')
    assert.equal(fee.value, plan.fee)

    const rate = field(result, 'feeRate')
    assert.ok(rate.kind === 'number')
    assert.equal(rate.value, 2)
    assert.equal(rate.unit?.code, BITCOIN_TEXTS.unit.satPerVbyte.code)

    const size = field(result, 'size')
    assert.ok(size.kind === 'number')
    assert.equal(size.value, plan.vsize)
    assert.equal(size.label.code, BITCOIN_TEXTS.label.estimatedSize.code)
    assert.equal(size.secondary, true)

    const txid = field(result, 'txid')
    assert.ok(txid.kind === 'text')
    assert.equal(txid.value, chain.decodePsbt(psbt).txid)
  })

  test('each input: its address (the signer`s), value, whether the value is checked, its coin', async () => {
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    const input = field(result, 'input-0')
    assert.ok(input.kind === 'list')
    assert.deepEqual(input.label.params, {index: 0})

    const from = field(result, 'input-0-from')
    assert.ok(from.kind === 'address')
    assert.equal(from.value, segwit.address)
    assert.equal(from.relation, 'self')

    const value = field(result, 'input-0-amount')
    assert.ok(value.kind === 'amount')
    assert.equal(value.value, 100_000n)

    const verified = field(result, 'input-0-verified')
    assert.ok(verified.kind === 'boolean')
    assert.equal(verified.value, false)

    const outpoint = field(result, 'input-0-outpoint')
    assert.ok(outpoint.kind === 'text')
    assert.equal(outpoint.value, `${'aa'.repeat(32)}:0`)
    assert.ok(field(result, 'input-0-derivation').kind === 'text')
    assert.equal(findField(result, 'input-0-sighash'), undefined)
  })

  test('each output is an action: the payment, then change back to the account', async () => {
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    assert.equal(result.actions.length, 2)

    const [payment, change] = result.actions
    assert.ok(payment && change)
    assert.deepEqual(payment.path, [0])
    assert.equal(payment.intent.code, INTENTS.send.code)
    assert.deepEqual(payment.source, {decoder: 'psbt', kind: 'builtin'})
    const to = field(payment, 'to')
    assert.ok(to.kind === 'address')
    assert.equal(to.relation, 'unknown')
    assert.equal(payment.risk, 'low')

    // The adapter's accounts are one address: change goes back to the address the coin is from.
    assert.deepEqual(change.path, [1])
    assert.equal(change.intent.code, BITCOIN_TEXTS.intent.change.code)
    assert.equal(change.summary?.code, BITCOIN_TEXTS.summary.change.code)
    const back = field(change, 'to')
    assert.ok(back.kind === 'address')
    assert.equal(back.relation, 'self')
    assert.equal(back.value, segwit.address)
    const amount = field(change, 'amount')
    assert.ok(amount.kind === 'amount')
    assert.equal(amount.value, plan.change)
  })

  test('warnings: the recipient is unknown, the value unchecked, the address reused', async () => {
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    assert.deepEqual(codes(result), ['UNKNOWN_DESTINATION', 'bitcoin.ADDRESS_REUSE', 'bitcoin.UNVERIFIED_VALUES'])

    const destination = only(result, 'UNKNOWN_DESTINATION')
    assert.deepEqual(destination.action, [0])
    assert.deepEqual(destination.fields, ['to'])

    const values = only(result, 'bitcoin.UNVERIFIED_VALUES')
    assert.equal(values.severity, 'medium')
    assert.deepEqual(values.action, [])
    assert.deepEqual(values.fields, ['input-0-amount'])

    const reuse = only(result, 'bitcoin.ADDRESS_REUSE')
    assert.equal(reuse.severity, 'info')
    assert.deepEqual(reuse.action, [1])
    assert.equal(result.risk, 'medium')
    assert.equal(actionAt(result, [1])?.risk, 'info')
  })

  test('Base64 text reads as its bytes', async () => {
    const fromBytes = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    const fromText = await clearSignPsbt(chain, ` ${base64(psbt)}\n`, {accounts: [...xpubAccounts]})
    assert.deepEqual(fromText, fromBytes)
  })

  test('with the previous transactions, the values are checked and nothing is unverified', async () => {
    const previous = previousTransaction(segwit.scriptPubKey, 100_000n)
    const checked = segwit.createTransaction({
      amount: 25_000n,
      feeRate: 2,
      to: other.address,
      utxos: [{txid: previous.txid, value: 100_000n, vout: 0}],
    })
    const result = await clearSignPsbt(
      chain,
      segwit.createPsbt(checked, {previousTransactions: {[previous.txid]: previous.raw}}),
      {accounts: [...xpubAccounts]}
    )

    assert.equal(has(result, 'bitcoin.UNVERIFIED_VALUES'), false)
    const verified = field(result, 'input-0-verified')
    assert.ok(verified.kind === 'boolean' && verified.value)
  })

  test('once signed, the size is the signed transaction`s, not an estimate', async () => {
    const {psbt: signed} = await segwit.signPsbt(psbt)
    const result = await clearSignPsbt(chain, signed, {accounts: [...xpubAccounts]})
    const size = field(result, 'size')

    assert.ok(size.kind === 'number')
    assert.equal(size.label.code, BITCOIN_TEXTS.label.size.code)
    assert.equal(size.value, chain.finalizePsbt(signed).vsize)
  })

  test('plain text reads as a review', async () => {
    const text = plainText(await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]}))

    assert.match(text, /^Send: Send 0\.00025 BTC to bc1q/)
    assert.match(text, /PSBT on Bitcoin\. Risk: medium\./)
    assert.match(text, /Fee rate: 2 sat\/vB/)
    assert.match(text, /Change: Return 0\.00074718 BTC to you as change/)
  })
})

describe('clearSignPsbt: Taproot, and Taproot mixed with P2WPKH', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {other, segwit, taproot, taprootChange} = accounts

  test('a Taproot payment: a signature that commits to every value needs no previous transaction', async () => {
    const plan = taproot.createTransaction({
      amount: 30_000n,
      feeRate: 3,
      to: other.address,
      utxos: [utxo('bb', 80_000)],
    })
    const result = await clearSignPsbt(chain, taproot.createPsbt(plan), {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, INTENTS.send.code)
    assert.equal(has(result, 'bitcoin.UNVERIFIED_VALUES'), false)
    const from = field(result, 'input-0-from')
    assert.ok(from.kind === 'address' && from.relation === 'self')
    const size = field(result, 'size')
    assert.ok(size.kind === 'number')
    assert.equal(size.value, plan.vsize)
  })

  test('P2WPKH and Taproot coins of one wallet, Taproot change: every input and the change are the signer`s', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: segwit, value: 40_000n},
        {account: taproot, value: 60_000n},
      ],
      [
        {account: other, noOrigin: true, value: 70_000n},
        {account: taprootChange, value: 29_000n},
      ]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, INTENTS.send.code)
    assert.equal(result.actions[1]?.intent.code, BITCOIN_TEXTS.intent.change.code)
    // The Taproot input's signature commits to the P2WPKH coin's value too.
    assert.equal(has(result, 'bitcoin.UNVERIFIED_VALUES'), false)
    assert.equal(has(result, 'bitcoin.FOREIGN_INPUTS'), false)
    assert.equal(has(result, 'bitcoin.UNVERIFIED_CHANGE'), false)

    const fee = field(result, 'fee')
    assert.ok(fee.kind === 'amount')
    assert.equal(fee.value, 1_000n)
    const derivation = field(actionAt(result, [1]) ?? result, 'derivation')
    assert.ok(derivation.kind === 'text')
    assert.equal(derivation.value, "m/86'/0'/0'/1/0")
  })

  test('the same transaction from the adapter and from btc-signer reads the same', async () => {
    const plan = segwit.createTransaction({amount: 10_000n, feeRate: 1, to: other.address, utxos: [utxo('cc', 50_000)]})
    const adapter = segwit.createPsbt(plan)
    const scure = btcSignerPsbt(
      [{account: {...segwit, fingerprint: FINGERPRINT}, salt: 0, value: 50_000n}],
      [
        {account: other, noOrigin: true, value: 10_000n},
        {account: segwit, value: plan.change},
      ]
    )
    const decodedAdapter = chain.decodePsbt(adapter)
    const decodedScure = chain.decodePsbt(scure)
    assert.deepEqual(
      decodedScure.outputs.map(output => [output.address, output.value]),
      decodedAdapter.outputs.map(output => [output.address, output.value])
    )

    const [fromAdapter, fromScure] = await Promise.all([
      clearSignPsbt(chain, adapter, {accounts: [...xpubAccounts]}),
      clearSignPsbt(chain, scure, {accounts: [...xpubAccounts]}),
    ])
    assert.deepEqual(codes(fromScure), codes(fromAdapter))
    assert.deepEqual(fromScure.summary, fromAdapter.summary)
    assert.deepEqual(
      fromScure.actions.map(action => [action.intent, action.fields]),
      fromAdapter.actions.map(action => [action.intent, action.fields])
    )
  })
})

describe('clearSignPsbt: whose coins and outputs these are', async () => {
  const {accounts, strangerFingerprint, xpubAccounts} = await setup()
  const {change, other, otherTaproot, receive, segwit, taproot} = accounts
  const payment = (changeOutput: Parameters<typeof btcSignerPsbt>[1][number]) =>
    btcSignerPsbt(
      [{account: segwit, previous: true, value: 100_000n}],
      [{account: other, noOrigin: true, value: 50_000n}, changeOutput]
    )

  test('by extended key: change at the account`s change path is derived and verified', async () => {
    const result = await clearSignPsbt(chain, payment({account: change, value: 49_000n}), {
      accounts: [...xpubAccounts],
    })
    const changeAction = actionAt(result, [1])
    assert.equal(changeAction?.intent.code, BITCOIN_TEXTS.intent.change.code)
    assert.equal(has(result, 'bitcoin.UNVERIFIED_CHANGE'), false)
    assert.equal(has(result, 'bitcoin.ADDRESS_REUSE'), false)
    assert.deepEqual(codes(result), ['UNKNOWN_DESTINATION'])
  })

  test('by fingerprint alone: change is the PSBT`s word, and says so', async () => {
    const result = await clearSignPsbt(chain, payment({account: change, value: 49_000n}), {
      accounts: {fingerprint: FINGERPRINT},
    })
    assert.equal(actionAt(result, [1])?.intent.code, BITCOIN_TEXTS.intent.change.code)

    const unverified = only(result, 'bitcoin.UNVERIFIED_CHANGE')
    assert.equal(unverified.severity, 'medium')
    assert.deepEqual(unverified.action, [1])
    assert.deepEqual(unverified.fields, ['to'])

    // With the account's path, the same.
    const withPath = await clearSignPsbt(chain, payment({account: change, value: 49_000n}), {
      accounts: {fingerprint: FINGERPRINT, path: 'm/84h/0h/0h'},
    })
    assert.equal(has(withPath, 'bitcoin.UNVERIFIED_CHANGE'), true)
    assert.equal(actionAt(withPath, [1])?.intent.code, BITCOIN_TEXTS.intent.change.code)
  })

  test('a stranger`s key at the signer`s change path: the extended key catches the lie, a fingerprint cannot', async () => {
    const lie = payment({
      account: other,
      origin: {fingerprint: FINGERPRINT, path: "m/84'/0'/0'/1/0", publicKey: other.publicKey},
      value: 49_000n,
    })

    const caught = await clearSignPsbt(chain, lie, {accounts: [...xpubAccounts]})
    assert.equal(actionAt(caught, [1])?.intent.code, INTENTS.send.code)
    const claim = only(caught, 'bitcoin.FALSE_DERIVATION')
    assert.equal(claim.severity, 'high')
    assert.deepEqual(claim.action, [1])
    assert.equal(
      warningsAt(caught, [1]).some(entry => entry.code === 'UNKNOWN_DESTINATION'),
      true
    )
    assert.equal(caught.summary?.code, BITCOIN_TEXTS.summary.sendMany.code)

    const believed = await clearSignPsbt(chain, lie, {accounts: {fingerprint: FINGERPRINT}})
    assert.equal(actionAt(believed, [1])?.intent.code, BITCOIN_TEXTS.intent.change.code)
    assert.equal(has(believed, 'bitcoin.FALSE_DERIVATION'), false)
    assert.equal(has(believed, 'bitcoin.UNVERIFIED_CHANGE'), true)
  })

  test('one address`s account (a watch-only account) and the core`s signer address', async () => {
    const watch = chain.watchAccount({fingerprint: FINGERPRINT, path: change.path, publicKey: change.publicKey})
    const byAccount = await clearSignPsbt(chain, payment({account: change, noOrigin: true, value: 49_000n}), {
      accounts: [segwit, watch],
    })
    assert.equal(actionAt(byAccount, [1])?.intent.code, BITCOIN_TEXTS.intent.change.code)
    assert.equal(has(byAccount, 'bitcoin.UNVERIFIED_CHANGE'), false)

    const bySigner = await clearSignPsbt(chain, payment({account: segwit, noOrigin: true, value: 49_000n}), {
      signer: segwit.address,
    })
    assert.equal(actionAt(bySigner, [1])?.intent.code, BITCOIN_TEXTS.intent.change.code)
    const from = field(bySigner, 'input-0-from')
    assert.ok(from.kind === 'address' && from.relation === 'self')
  })

  test('without accounts nothing is anyone`s: every output is a payment, and no input is foreign', async () => {
    const result = await clearSignPsbt(chain, payment({account: change, value: 49_000n}))

    assert.equal(result.intent.code, INTENTS.send.code)
    assert.equal(result.summary?.code, BITCOIN_TEXTS.summary.sendMany.code)
    assert.deepEqual(result.summary?.params, {amount: '0.00099 BTC', count: 2})
    assert.equal(has(result, 'bitcoin.FOREIGN_INPUTS'), false)
    assert.equal(has(result, 'bitcoin.NO_OWN_INPUTS'), false)
    assert.equal(result.warnings.filter(entry => entry.code === 'UNKNOWN_DESTINATION').length, 2)
  })

  test('to the signer`s own receiving address, or one the names resolver calls its own: a transfer to yourself', async () => {
    const psbt = btcSignerPsbt(
      [{account: segwit, previous: true, value: 100_000n}],
      [{account: receive, value: 99_000n}]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)
    assert.deepEqual(result.summary?.params, {amount: '0.00099 BTC'})
    assert.equal(actionAt(result, [0])?.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)
    assert.deepEqual(codes(result), [])

    const savings = btcSignerPsbt(
      [{account: segwit, previous: true, value: 100_000n}],
      [{account: other, noOrigin: true, value: 99_000n}]
    )
    const named = await clearSignPsbt(chain, savings, {
      accounts: [...xpubAccounts],
      resolvers: {
        names: {name: ({address}) => (address === other.address ? {name: 'Savings', relation: 'own'} : undefined)},
      },
    })
    assert.equal(named.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)
    const to = field(actionAt(named, [0]) ?? named, 'to')
    assert.ok(to.kind === 'address')
    assert.deepEqual([to.relation, to.name], ['own', 'Savings'])
    assert.equal(has(named, 'UNKNOWN_DESTINATION'), false)
  })

  test('consolidation: several of the signer`s coins into one', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: segwit, previous: true, value: 10_000n},
        {account: receive, previous: true, value: 20_000n},
        {account: taproot, value: 30_000n},
      ],
      [{account: change, value: 59_000n}]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.consolidate.code)
    assert.deepEqual(result.summary?.params, {amount: '0.00059 BTC', count: 3})
    assert.deepEqual(codes(result), [])
  })

  test('other wallets` coins too: "Sign part of a transaction", with what the signer puts in and gets back', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: segwit, previous: true, value: 100_000n},
        {account: {...otherTaproot, fingerprint: strangerFingerprint}, value: 200_000n},
      ],
      [
        {account: otherTaproot, noOrigin: true, value: 260_000n},
        {account: change, value: 39_000n},
      ]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(result.summary?.params, {count: 1, total: 2})

    const foreign = only(result, 'bitcoin.FOREIGN_INPUTS')
    assert.equal(foreign.severity, 'low')
    assert.deepEqual(foreign.fields, ['input-1'])
    const theirs = field(result, 'input-1-from')
    assert.ok(theirs.kind === 'address' && theirs.relation === 'unknown')

    const net = field(result, 'net')
    assert.ok(net.kind === 'amount')
    assert.equal(net.label.code, BITCOIN_TEXTS.label.youPay.code)
    assert.equal(net.value, 61_000n)
    const yours = field(result, 'yourCoins')
    assert.ok(yours.kind === 'amount' && yours.value === 100_000n)
    const back = field(result, 'backToYou')
    assert.ok(back.kind === 'amount' && back.value === 39_000n)
  })

  test('none of the inputs is the signer`s: nothing to sign', async () => {
    const psbt = btcSignerPsbt(
      [{account: {...other, fingerprint: strangerFingerprint}, value: 10_000n}],
      [{account: segwit, noOrigin: true, value: 9_000n}]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})

    assert.equal(result.intent.code, BITCOIN_TEXTS.intent.signPart.code)
    assert.deepEqual(result.summary?.params, {count: 0, total: 1})
    assert.equal(only(result, 'bitcoin.NO_OWN_INPUTS').severity, 'medium')
    assert.equal(has(result, 'bitcoin.FOREIGN_INPUTS'), false)
  })

  test('an input whose coin is not stated: no fee, and it says why', async () => {
    const psbt = btcSignerPsbt(
      [
        {account: segwit, previous: true, value: 100_000n},
        {account: receive, noUtxo: true, value: 20_000n},
      ],
      [{account: other, noOrigin: true, value: 110_000n}]
    )
    const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    const fee = only(result, 'bitcoin.UNKNOWN_FEE')

    assert.equal(fee.severity, 'medium')
    assert.deepEqual(fee.fields, ['input-1'])
    assert.equal(findField(result, 'fee'), undefined)
    assert.equal(findField(result, 'feeRate'), undefined)
    assert.equal(findField(result, 'input-1-amount'), undefined)
  })
})

describe('clearSignPsbt: outputs worth a second look', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts
  const read = (outputs: Parameters<typeof btcSignerPsbt>[1], value = 100_000n) =>
    clearSignPsbt(chain, btcSignerPsbt([{account: segwit, previous: true, value}], outputs), {
      accounts: [...xpubAccounts],
    })

  test('dust: below the script`s limit is flagged, at it is not', async () => {
    const dust = await read([
      {account: other, noOrigin: true, value: 293n},
      {account: change, value: 99_000n},
    ])
    const warning = only(dust, 'bitcoin.DUST_OUTPUT')
    assert.equal(warning.severity, 'low')
    assert.deepEqual([warning.action, warning.fields], [[0], ['amount']])
    assert.deepEqual(warning.params, {limit: '0.00000294 BTC'})

    const fine = await read([
      {account: other, noOrigin: true, value: 294n},
      {account: change, value: 99_000n},
    ])
    assert.equal(has(fine, 'bitcoin.DUST_OUTPUT'), false)
  })

  test('a SegWit version nothing defines yet: anyone can spend it', async () => {
    const future = Uint8Array.of(0x52, 32, ...new Uint8Array(32).fill(7))
    const result = await read([
      {script: future, value: 10_000n},
      {account: change, value: 89_000n},
    ])
    const warning = only(result, 'bitcoin.UNKNOWN_SCRIPT_TYPE')
    assert.equal(warning.severity, 'high')
    assert.deepEqual(warning.action, [0])
    const to = field(actionAt(result, [0]) ?? result, 'to')
    assert.ok(to.kind === 'address' && to.value.startsWith('bc1z'))

    const taproot = await read([
      {account: accounts.otherTaproot, noOrigin: true, value: 10_000n},
      {account: change, value: 89_000n},
    ])
    assert.equal(has(taproot, 'bitcoin.UNKNOWN_SCRIPT_TYPE'), false)
  })

  test('a script with no address: shown raw, and flagged', async () => {
    // A bare public key (P2PK): someone's, but nothing here can say whose.
    const bare = Uint8Array.of(33, ...other.publicKey, 0xac)
    const result = await read([
      {script: bare, value: 10_000n},
      {account: change, value: 89_000n},
    ])
    const action = actionAt(result, [0])
    assert.ok(action)
    assert.equal(action.intent.code, BITCOIN_TEXTS.intent.unknownScript.code)
    assert.deepEqual(action.source, {kind: 'unknown'})
    const raw = field(action, 'script')
    assert.ok(raw.kind === 'raw')
    assert.equal(raw.value, `0x${Buffer.from(bare).toString('hex')}`)
    const warning = only(result, 'bitcoin.NO_ADDRESS_OUTPUT')
    assert.deepEqual([warning.severity, warning.action], ['high', [0]])
    assert.equal(result.summary?.code, BITCOIN_TEXTS.summary.unknownScript.code)

    const data = await read([
      {script: Uint8Array.of(0x6a, 2, 0x68, 0x69), value: 0n},
      {account: change, value: 99_000n},
    ])
    assert.equal(has(data, 'bitcoin.NO_ADDRESS_OUTPUT'), false)
  })

  test('two outputs to one address', async () => {
    const result = await read([
      {account: other, noOrigin: true, value: 10_000n},
      {account: other, noOrigin: true, value: 20_000n},
      {account: change, value: 69_000n},
    ])
    const duplicates = result.warnings.filter(entry => entry.code === 'bitcoin.DUPLICATE_OUTPUT')
    assert.deepEqual(
      duplicates.map(entry => [entry.action, entry.params]),
      [
        [[0], {outputs: '0, 1'}],
        [[1], {outputs: '0, 1'}],
      ]
    )
    assert.equal(result.summary?.code, BITCOIN_TEXTS.summary.sendMany.code)

    const distinct = await read([
      {account: other, noOrigin: true, value: 10_000n},
      {account: change, value: 89_000n},
    ])
    assert.equal(has(distinct, 'bitcoin.DUPLICATE_OUTPUT'), false)
  })

  test('OP_RETURN data: text when it reads as text, bytes when not, and bitcoin in it is burned', async () => {
    const text = await read([
      {script: Uint8Array.of(0x6a, 5, ...Buffer.from('hello')), value: 0n},
      {account: change, value: 99_000n},
    ])
    const action = actionAt(text, [0])
    assert.ok(action)
    assert.equal(action.intent.code, BITCOIN_TEXTS.intent.data.code)
    assert.deepEqual(action.source, {decoder: 'op-return', kind: 'builtin'})
    const data = field(action, 'data')
    assert.ok(data.kind === 'text')
    assert.equal(data.value, 'hello')
    assert.equal(has(text, 'bitcoin.BURN'), false)
    assert.equal(text.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)

    const bytes = await read([
      {script: Uint8Array.of(0x6a, 4, 0xde, 0xad, 0xbe, 0xef), value: 0n},
      {account: change, value: 99_000n},
    ])
    const raw = field(actionAt(bytes, [0]) ?? bytes, 'data')
    assert.ok(raw.kind === 'raw')
    assert.equal(raw.value, '0xdeadbeef')

    // Not pushes after OP_RETURN: the script, raw.
    const opcodes = await read([
      {script: Uint8Array.of(0x6a, 0x51, 0x52), value: 0n},
      {account: change, value: 99_000n},
    ])
    const script = field(actionAt(opcodes, [0]) ?? opcodes, 'data')
    assert.ok(script.kind === 'raw')
    assert.equal(script.value, '0x6a5152')

    const burned = await read([
      {script: Uint8Array.of(0x6a, 5, ...Buffer.from('hello')), value: 5_000n},
      {account: change, value: 94_000n},
    ])
    const burn = only(burned, 'bitcoin.BURN')
    assert.deepEqual([burn.severity, burn.action, burn.fields], ['critical', [0], ['amount']])
    assert.equal(actionAt(burned, [0])?.intent.code, BITCOIN_TEXTS.intent.burn.code)
    assert.equal(burned.risk, 'critical')
  })
})

describe('clearSignPsbt: the root when no payment leads', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts
  const read = (outputs: Parameters<typeof btcSignerPsbt>[1], options: object = {accounts: [...xpubAccounts]}) =>
    clearSignPsbt(chain, btcSignerPsbt([{account: segwit, previous: true, value: 100_000n}], outputs), options)
  const data = (words: string, value = 0n) => ({script: opReturn(Buffer.from(words)), value})

  test('only OP_RETURN outputs: data recorded, however many, and the whole coin is the fee', async () => {
    const one = await read([data('hello')])
    assert.equal(one.intent.code, BITCOIN_TEXTS.intent.data.code)
    assert.equal(one.summary?.code, BITCOIN_TEXTS.summary.data.code)
    assert.equal(findField(one, 'amount'), undefined)
    const fee = field(one, 'fee')
    assert.ok(fee.kind === 'amount' && fee.value === 100_000n)
    assert.deepEqual(only(one, 'HIGH_FEE').fields, ['fee', 'feeRate'])

    // Several records are data too (they read as intent.unknown before).
    const two = await read([data('hello'), {script: opReturn([1, 2, 3]), value: 0n}])
    assert.equal(two.intent.code, BITCOIN_TEXTS.intent.data.code)
    assert.equal(two.summary?.code, BITCOIN_TEXTS.summary.data.code)
    assert.deepEqual(
      two.actions.map(action => action.intent.code),
      [BITCOIN_TEXTS.intent.data.code, BITCOIN_TEXTS.intent.data.code]
    )
    assert.deepEqual(codes(two), ['HIGH_FEE'])

    // The near case: data beside change is a transfer to yourself, as before.
    const kept = await read([data('hello'), {account: change, value: 99_000n}])
    assert.equal(kept.intent.code, BITCOIN_TEXTS.intent.selfTransfer.code)
  })

  test('a burn only: the root destroys what every OP_RETURN output carries', async () => {
    const burn = await read([data('bye', 99_000n)])
    assert.equal(burn.intent.code, BITCOIN_TEXTS.intent.burn.code)
    assert.deepEqual(burn.summary?.params, {amount: '0.00099 BTC'})
    assert.equal(findField(burn, 'amount'), undefined)
    const warning = only(burn, 'bitcoin.BURN')
    assert.deepEqual([warning.severity, warning.action, warning.fields], ['critical', [0], ['amount']])
    assert.equal(burn.risk, 'critical')
    assert.equal(has(burn, 'HIGH_FEE'), false)

    const burns = await read([data('bye', 40_000n), data('and bye'), data('again', 59_000n)])
    assert.equal(burns.intent.code, BITCOIN_TEXTS.intent.burn.code)
    assert.deepEqual(burns.summary?.params, {amount: '0.00099 BTC'})
    assert.deepEqual(
      burns.warnings.filter(entry => entry.code === 'bitcoin.BURN').map(entry => entry.action),
      [[0], [2]]
    )
  })

  test('a single payment to a script with no address: a send, of an amount to a script, never a destination', async () => {
    const bare = Uint8Array.of(33, ...other.publicKey, 0xac)

    for (const options of [{accounts: [...xpubAccounts]}, {}]) {
      const result = await read([{script: bare, value: 99_000n}], options)
      assert.equal(result.intent.code, INTENTS.send.code)
      assert.equal(result.summary?.code, BITCOIN_TEXTS.summary.unknownScript.code)
      assert.deepEqual(result.summary?.params, {amount: '0.00099 BTC'})
      const amount = field(result, 'amount')
      assert.ok(amount.kind === 'amount' && amount.value === 99_000n)
      const warning = only(result, 'bitcoin.NO_ADDRESS_OUTPUT')
      assert.deepEqual([warning.severity, warning.action, warning.fields], ['high', [0], ['amount']])
      assert.equal(has(result, 'UNKNOWN_DESTINATION'), false)
      assert.equal(actionAt(result, [0])?.intent.code, BITCOIN_TEXTS.intent.unknownScript.code)
    }
  })
})

describe('clearSignPsbt: the fee', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts
  const pay = (amount: bigint, fee: bigint, value = 1_000_000n) =>
    btcSignerPsbt(
      [{account: segwit, previous: true, value}],
      [
        {account: other, noOrigin: true, value: amount},
        ...(value - amount - fee > 0n ? [{account: change, value: value - amount - fee}] : []),
      ]
    )

  test('a rate above 500 sat/vB is high, 2 sat/vB is not', async () => {
    // 141 vB: 100,000 sats is 709 sat/vB.
    const high = await clearSignPsbt(chain, pay(500_000n, 100_000n), {accounts: [...xpubAccounts]})
    const warning = only(high, 'HIGH_FEE')
    assert.equal(warning.severity, 'medium')
    assert.deepEqual(warning.fields, ['fee', 'feeRate'])
    assert.equal(warning.params?.fee, '0.001 BTC')

    const normal = await clearSignPsbt(chain, pay(500_000n, 282n), {accounts: [...xpubAccounts]})
    assert.equal(has(normal, 'HIGH_FEE'), false)
    const lower = await clearSignPsbt(chain, pay(500_000n, 282n), {accounts: [...xpubAccounts], maxFeeRate: 1.5})
    assert.equal(has(lower, 'HIGH_FEE'), true)
  })

  test('a fee more than 10 % of what is sent, above 10,000 sats, is high; dust-sized sends are not judged so', async () => {
    const share = await clearSignPsbt(chain, pay(100_000n, 15_000n), {accounts: [...xpubAccounts], maxFeeRate: 10_000})
    assert.equal(has(share, 'HIGH_FEE'), true)
    const fine = await clearSignPsbt(chain, pay(200_000n, 15_000n), {accounts: [...xpubAccounts], maxFeeRate: 10_000})
    assert.equal(has(fine, 'HIGH_FEE'), false)
    const looser = await clearSignPsbt(chain, pay(100_000n, 15_000n), {
      accounts: [...xpubAccounts],
      maxFeePercent: 20,
      maxFeeRate: 10_000,
    })
    assert.equal(has(looser, 'HIGH_FEE'), false)

    // An inscription's postage: 546 sats sent for a 2,000 sat fee.
    const postage = await clearSignPsbt(chain, pay(546n, 2_000n), {accounts: [...xpubAccounts]})
    assert.equal(has(postage, 'HIGH_FEE'), false)
  })

  test('a fee above the absolute limit is high, whatever the size', async () => {
    const result = await clearSignPsbt(chain, pay(500_000n, 30_000n), {
      accounts: [...xpubAccounts],
      maxFee: 20_000n,
      maxFeeRate: 10_000,
    })
    assert.deepEqual(only(result, 'HIGH_FEE').fields, ['fee', 'feeRate'])
  })
})

describe('clearSignPsbt: resolvers', async () => {
  const {accounts, xpubAccounts} = await setup()
  const {change, other, segwit} = accounts
  const psbt = btcSignerPsbt(
    [{account: segwit, previous: true, value: 100_000n}],
    [
      {account: other, noOrigin: true, value: 50_000n},
      {account: change, value: 49_000n},
    ]
  )
  const names = {
    name: ({address}: {readonly address: string}) =>
      address === other.address ? ({name: 'Alice', relation: 'contact'} as const) : undefined,
  }

  test('offline, sync and async: the same names, and a contact is no unknown destination', async () => {
    const offline = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts]})
    assert.equal(has(offline, 'UNKNOWN_DESTINATION'), true)

    for (const resolvers of [{names}, asyncResolvers({names})]) {
      const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts], resolvers})
      assert.deepEqual(result.summary?.params, {amount: '0.0005 BTC', recipient: 'Alice'})
      const to = field(actionAt(result, [0]) ?? result, 'to')
      assert.ok(to.kind === 'address')
      assert.deepEqual([to.name, to.relation], ['Alice', 'contact'])
      assert.deepEqual(codes(result), [])
    }
  })

  test('a resolver that throws or answers nonsense: the result still comes, with RESOLVER_FAILED', async () => {
    for (const name of [
      () => {
        throw new Error('offline')
      },
      () => Promise.reject(new Error('offline')),
      () => ({name: 'Ali‮ce', relation: 'contact'}) as never,
      () => ({name: 'Alice', relation: 'friend'}) as never,
    ]) {
      const result = await clearSignPsbt(chain, psbt, {accounts: [...xpubAccounts], resolvers: {names: {name}}})
      const failed = only(result, 'RESOLVER_FAILED')
      assert.equal(failed.severity, 'info')
      assert.deepEqual(failed.params, {resolvers: 'names'})
      assert.equal(has(result, 'UNKNOWN_DESTINATION'), true)
    }
  })
})

describe('clearSignPsbt: networks, and what it refuses', async () => {
  const {accounts, xpubAccounts} = await setup()

  test('CAIP-2 ids: testnet is testnet4 unless told, and test coins are tBTC', async () => {
    const testnet = crypto.chains['bitcoin-testnet']
    const account = await (await crypto.createEphemeralWallet()).deriveAccount({chain: 'bitcoin-testnet'})
    const plan = account.createTransaction({
      amount: 10_000n,
      feeRate: 1,
      to: account.address,
      utxos: [utxo('dd', 50_000)],
    })
    const psbt = account.createPsbt(plan)

    const four = await clearSignPsbt(testnet, psbt)
    assert.deepEqual(four.chain, {family: 'bitcoin', id: BITCOIN_CHAIN_IDS.testnet4, name: 'Bitcoin Testnet4'})
    const fee = field(four, 'fee')
    assert.ok(fee.kind === 'amount' && fee.symbol === 'tBTC')

    const three = await clearSignPsbt(testnet, psbt, {testnet: 'testnet3'})
    assert.equal(three.chain.id, 'bip122:000000000933ea01ad0ee984209779ba')
    assert.equal((await clearSignPsbt(crypto.chains['bitcoin-signet'], psbt)).chain.id, BITCOIN_CHAIN_IDS.signet)
    assert.equal((await clearSignPsbt(crypto.chains['bitcoin-regtest'], psbt)).chain.id, BITCOIN_CHAIN_IDS.regtest)
  })

  test('options out of range are INVALID_ARGUMENT', async () => {
    const plan = accounts.segwit.createTransaction({
      amount: 10_000n,
      feeRate: 1,
      to: accounts.other.address,
      utxos: [utxo('ee', 50_000)],
    })
    const psbt = accounts.segwit.createPsbt(plan)

    for (const options of [
      {testnet: 'testnet5' as never},
      {maxFeeRate: 0},
      {maxFeePercent: Number.NaN},
      {maxFee: -1n},
      {maxFee: 5 as never},
      {tipHeight: -1},
      {tipHeight: 1.5},
      {signer: 'tb1qnotmainnet'},
      {accounts: [{fingerprint: 2 ** 32}]},
      {accounts: [{fingerprint: 1, path: 'm/x'}]},
      {
        accounts: [
          {addressType: 'p2sh' as never, extendedKey: xpubAccounts[0].extendedKey, fingerprint: 1, path: "m/84'/0'/0'"},
        ],
      },
      {accounts: [null as never]},
    ]) {
      await rejectsWith(clearSignPsbt(chain, psbt, options), 'INVALID_ARGUMENT')
    }
  })

  test('what is not a PSBT is INVALID_INPUT, the adapter`s error its cause', async () => {
    for (const payload of [
      new Uint8Array(),
      Uint8Array.of(0x70, 0x73, 0x62, 0x74),
      'not base64!',
      'cHNidP8=',
      42 as never,
    ]) {
      await assert.rejects(clearSignPsbt(chain, payload), error => isClearSignError(error, 'INVALID_INPUT'))
    }

    const error = await clearSignPsbt(chain, Uint8Array.of(1, 2, 3)).catch((caught: unknown) => caught)
    assert.ok(isClearSignError(error, 'INVALID_INPUT'))
    assert.equal((error.cause as {code?: string}).code, 'INVALID_ARGUMENT')
  })

  test('labels are the shared ones where they exist', async () => {
    const plan = accounts.segwit.createTransaction({
      amount: 10_000n,
      feeRate: 1,
      to: accounts.other.address,
      utxos: [utxo('ff', 50_000)],
    })
    const result = await clearSignPsbt(chain, accounts.segwit.createPsbt(plan))
    assert.equal(field(result, 'fee').label.code, LABELS.fee.code)
    assert.equal(field(result, 'amount').label.code, LABELS.amount.code)
    assert.equal(field(actionAt(result, [0]) ?? result, 'to').label.code, LABELS.to.code)
    assert.equal(WARNINGS.UNKNOWN_DESTINATION.code, 'UNKNOWN_DESTINATION')
    assert.equal(BITCOIN_WARNINGS.FOREIGN_INPUTS.code, 'bitcoin.FOREIGN_INPUTS')
  })
})
