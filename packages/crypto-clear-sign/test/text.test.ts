import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  defineTexts,
  EXTERNAL_TEXT_CODE,
  externalText,
  INTENTS,
  interpolate,
  isClearSignError,
  isTextCode,
  LABELS,
  localize,
  SUMMARIES,
  TEXT_GROUPS,
  text,
  WARNINGS,
  warning,
} from '../src'

const throwsInvalid = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

describe('text', () => {
  test('interpolate fills each placeholder it has a value for, and leaves the others', () => {
    assert.equal(
      interpolate('Send {amount} to {recipient}', {amount: '1 ETH', recipient: 'Alice'}),
      'Send 1 ETH to Alice'
    )
    assert.equal(interpolate('{count} actions', {count: 3}), '3 actions')
    assert.equal(interpolate('Send {amount} to {recipient}', {amount: '1 ETH'}), 'Send 1 ETH to {recipient}')
    assert.equal(interpolate('No {params} here'), 'No {params} here')
    // An inherited key is not a param.
    assert.equal(interpolate('{toString}', {}), '{toString}')
  })

  test('text fills a template and keeps its params for translations', () => {
    const summary = text(SUMMARIES.approveUnlimited, {spender: 'Uniswap', token: 'USDC'})
    assert.deepEqual(summary, {
      code: 'summary.approveUnlimited',
      params: {spender: 'Uniswap', token: 'USDC'},
      text: 'Allow Uniswap to spend an unlimited amount of USDC',
    })
    // Without params, or with none, it is the template's code and English only.
    assert.deepEqual(text(INTENTS.approve), {code: 'intent.approve', text: 'Approve'})
    assert.deepEqual(text(LABELS.amount, {}), {code: 'label.amount', text: 'Amount'})
    // A title and a sentence about the same thing have codes of their own.
    assert.notEqual(INTENTS.approve.code, SUMMARIES.approve.code)
    throwsInvalid(() => text({code: 'Not a code', text: 'x'}))
    throwsInvalid(() => text({code: 'approve', text: 'x'}))
  })

  test('external text is shown as is and never translated by code', () => {
    const label = externalText('Amount to send')
    assert.deepEqual(label, {code: EXTERNAL_TEXT_CODE, text: 'Amount to send'})
    assert.equal(localize(label, {external: 'Přeloženo'}), 'Amount to send')
  })

  test('defineTexts namespaces a chain package`s texts, by group', () => {
    const texts = defineTexts('ethereum', {
      intent: {permit: 'Permit'},
      label: {gasLimit: 'Gas limit'},
      summary: {permit: 'Allow {spender} to spend {amount} by signature'},
    })
    assert.deepEqual(texts.label.gasLimit, {code: 'ethereum.label.gasLimit', text: 'Gas limit'})
    assert.deepEqual(texts.intent.permit, {code: 'ethereum.intent.permit', text: 'Permit'})
    assert.equal(
      text(texts.summary.permit, {amount: '5 USDC', spender: 'Permit2'}).text,
      'Allow Permit2 to spend 5 USDC by signature'
    )
    // The type says the code too.
    const code: 'ethereum.summary.permit' = texts.summary.permit.code
    assert.ok(isTextCode(code))
    assert.ok(Object.isFrozen(texts) && Object.isFrozen(texts.label) && Object.isFrozen(texts.label.gasLimit))

    throwsInvalid(() => defineTexts('Ethereum', {label: {gasLimit: 'Gas limit'}}))
    throwsInvalid(() => defineTexts('ethereum.mainnet', {label: {gasLimit: 'Gas limit'}}))
    throwsInvalid(() => defineTexts('ethereum', {Label: {gasLimit: 'Gas limit'}}))
    throwsInvalid(() => defineTexts('ethereum', {label: {GAS_LIMIT: 'Gas limit'}}))
    throwsInvalid(() => defineTexts('ethereum', {label: {gasLimit: 1 as unknown as string}}))
    throwsInvalid(() => defineTexts('ethereum', {label: 'Gas limit' as never}))
  })

  test('isTextCode: group.key, family.group.key, or external', () => {
    for (const code of [
      'label.amount',
      'summary.approveUnlimited',
      'ethereum.label.gasLimit',
      'solana-devnet.unit.lamports',
      EXTERNAL_TEXT_CODE,
    ]) {
      assert.ok(isTextCode(code), code)
    }

    for (const code of [
      '',
      'amount',
      'label.Amount',
      'label.gas_limit',
      'label.',
      '.amount',
      'a.b.c.d',
      'Ethereum.label.gasLimit',
      'external.',
      3,
    ]) {
      assert.ok(!isTextCode(code), String(code))
    }
  })

  test('localize: a translation by code with the same params, else the English', () => {
    const translations = {
      'intent.approve': 'Schválit',
      'summary.approveUnlimited': 'Povolit {spender} neomezeně utrácet {token}',
    }
    assert.equal(localize(INTENTS.approve, translations), 'Schválit')
    assert.equal(
      localize(text(SUMMARIES.approveUnlimited, {spender: 'Uniswap', token: 'USDC'}), translations),
      'Povolit Uniswap neomezeně utrácet USDC'
    )
    assert.equal(localize(INTENTS.send, translations), 'Send')
    assert.equal(localize(INTENTS.send), 'Send')
    // An inherited key is not a translation.
    assert.equal(localize({code: 'constructor', text: 'Constructor'}, {}), 'Constructor')
    assert.equal(localize(SUMMARIES.approve, translations), SUMMARIES.approve.text)

    // Warnings translate by their code.
    const unlimited = warning(WARNINGS.UNLIMITED_APPROVAL)
    assert.equal(localize(unlimited), WARNINGS.UNLIMITED_APPROVAL.message)
    assert.equal(localize(unlimited, {UNLIMITED_APPROVAL: 'Neomezené schválení'}), 'Neomezené schválení')
  })

  test('the shared catalogs: coded group.key, frozen, no em dashes', () => {
    for (const [group, catalog] of [
      ['intent', INTENTS],
      ['summary', SUMMARIES],
      ['label', LABELS],
    ] as const) {
      assert.ok(Object.isFrozen(catalog))
      assert.ok(TEXT_GROUPS.includes(group))

      for (const [key, entry] of Object.entries(catalog)) {
        assert.equal(entry.code, `${group}.${key}`)
        assert.ok(isTextCode(entry.code))
        assert.ok(!entry.text.includes('—'), key)
        assert.ok(Object.isFrozen(entry))
      }
    }
  })
})
