import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  defineWarnings,
  isClearSignError,
  isSeverity,
  isSharedWarningCode,
  isWarningCode,
  type SharedWarningCode,
  WARNINGS,
  warning,
} from '../src'

const throwsInvalid = (run: () => unknown) => assert.throws(run, error => isClearSignError(error, 'INVALID_ARGUMENT'))

describe('warnings', () => {
  test('the shared codes: each its own key, with a severity and English without em dashes', () => {
    const codes: SharedWarningCode[] = [
      'ALL_CHAINS',
      'ASSET_OWNERSHIP_TRANSFER',
      'BLIND_SIGNING',
      'EXPIRED',
      'HIDDEN_CHARACTERS',
      'HIGH_FEE',
      'LONG_LIVED',
      'RESOLVER_FAILED',
      'UNKNOWN_CONTRACT_CALL',
      'UNKNOWN_DESTINATION',
      'UNKNOWN_TOKEN',
      'UNLIMITED_APPROVAL',
    ]
    assert.deepEqual(Object.keys(WARNINGS).sort(), codes)
    assert.ok(Object.isFrozen(WARNINGS))

    for (const [key, definition] of Object.entries(WARNINGS)) {
      assert.equal(definition.code, key)
      assert.ok(isSeverity(definition.severity))
      assert.ok(definition.message.length > 0 && !definition.message.includes('—'), key)
    }

    // The severities a UI can rely on for the codes that matter most.
    assert.equal(WARNINGS.UNLIMITED_APPROVAL.severity, 'critical')
    assert.equal(WARNINGS.ASSET_OWNERSHIP_TRANSFER.severity, 'critical')
    assert.equal(WARNINGS.UNKNOWN_CONTRACT_CALL.severity, 'high')
    assert.equal(WARNINGS.BLIND_SIGNING.severity, 'high')
    assert.equal(WARNINGS.RESOLVER_FAILED.severity, 'info')
  })

  test('warning: the definition`s severity and English, params filled, fields kept', () => {
    assert.deepEqual(warning(WARNINGS.UNLIMITED_APPROVAL), {
      code: 'UNLIMITED_APPROVAL',
      message: WARNINGS.UNLIMITED_APPROVAL.message,
      severity: 'critical',
    })
    assert.deepEqual(warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']}).fields, [
      'amount',
      'spender',
    ])
    assert.equal(warning(WARNINGS.UNLIMITED_APPROVAL, {fields: []}).fields, undefined)

    const custom = defineWarnings('test', {LIMIT: {message: 'More than {limit} a day.', severity: 'medium'}})
    const raised = warning(custom.LIMIT, {params: {limit: '1 ETH'}})
    assert.deepEqual(raised, {
      code: 'test.LIMIT',
      message: 'More than 1 ETH a day.',
      params: {limit: '1 ETH'},
      severity: 'medium',
    })

    // Overrides, for a chain package that documents why.
    const louder = warning(WARNINGS.HIGH_FEE, {message: 'The fee is more than what is sent.', severity: 'high'})
    assert.equal(louder.severity, 'high')
    assert.equal(louder.message, 'The fee is more than what is sent.')
  })

  test('defineWarnings namespaces a chain package`s codes', () => {
    const ethereum = defineWarnings('ethereum', {
      CONTRACT_CREATION: {message: 'This deploys a contract.', severity: 'info'},
      DELEGATION: {message: 'This lets a contract run code as your account.', severity: 'critical'},
    })
    assert.deepEqual(ethereum.DELEGATION, {
      code: 'ethereum.DELEGATION',
      message: 'This lets a contract run code as your account.',
      severity: 'critical',
    })
    assert.ok(Object.isFrozen(ethereum) && Object.isFrozen(ethereum.DELEGATION))
    // The type says the code too.
    const code: 'ethereum.CONTRACT_CREATION' = ethereum.CONTRACT_CREATION.code
    assert.equal(code, 'ethereum.CONTRACT_CREATION')

    throwsInvalid(() => defineWarnings('Ethereum', {X: {message: 'x', severity: 'low'}}))
    throwsInvalid(() => defineWarnings('ethereum', {delegation: {message: 'x', severity: 'low'}}))
    throwsInvalid(() => defineWarnings('ethereum', {X: {message: 'x', severity: 'severe' as 'low'}}))
    throwsInvalid(() => defineWarnings('ethereum', {X: {message: 1 as unknown as string, severity: 'low'}}))
  })

  test('isSharedWarningCode and isWarningCode', () => {
    assert.ok(isSharedWarningCode('UNLIMITED_APPROVAL'))
    assert.ok(!isSharedWarningCode('ethereum.DELEGATION'))
    assert.ok(!isSharedWarningCode('toString'))
    assert.ok(!isSharedWarningCode(undefined))

    for (const code of [
      'UNLIMITED_APPROVAL',
      'ethereum.DELEGATION',
      'solana.OTHER_SIGNERS',
      'bitcoin.FOREIGN_INPUTS',
    ]) {
      assert.ok(isWarningCode(code), code)
    }

    for (const code of ['UNLIMITED', 'DELEGATION', 'ethereum.delegation', 'Ethereum.DELEGATION', 'ethereum.', '', 7]) {
      assert.ok(!isWarningCode(code), String(code))
    }
  })
})
