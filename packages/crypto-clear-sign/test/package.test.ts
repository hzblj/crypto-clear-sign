import assert from 'node:assert/strict'
import {readdirSync, readFileSync} from 'node:fs'
import {describe, test} from 'node:test'

import * as api from '../src'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('the package', () => {
  test('VERSION matches package.json', () => {
    assert.equal(api.VERSION, JSON.parse(read('../package.json')).version)
  })

  test('the documented runtime exports, and nothing internal', () => {
    assert.deepEqual(Object.keys(api).sort(), [
      'ADDRESS_RELATIONS',
      'CLEAR_SIGN_ERROR_CODES',
      'ClearSignError',
      'EXTERNAL_TEXT_CODE',
      'FIELD_KINDS',
      'INTENTS',
      'LABELS',
      'LONG_LIVED_AFTER',
      'MAX_ACTION_DEPTH',
      'MAX_DECIMALS',
      'MAX_TIME',
      'RESOLVER_NAMES',
      'RISK_LEVELS',
      'SEVERITIES',
      'SIGNING_KINDS',
      'SUMMARIES',
      'TEXT_GROUPS',
      'UNLIMITED_TEXT',
      'VERSION',
      'WARNINGS',
      'actionAt',
      'addressField',
      'amountField',
      'booleanField',
      'checkDeadline',
      'checkDuration',
      'compareRisk',
      'createClearSigning',
      'createResolverContext',
      'dateTimeField',
      'defineTexts',
      'defineWarnings',
      'durationField',
      'externalText',
      'findField',
      'formatAmount',
      'formatDateTime',
      'formatDuration',
      'formatField',
      'fromUnixSeconds',
      'hasHiddenCharacters',
      'hasWarning',
      'interpolate',
      'isClearSignError',
      'isField',
      'isFieldKind',
      'isRiskLevel',
      'isSeverity',
      'isSharedWarningCode',
      'isSigningKind',
      'isTextCode',
      'isWarningCode',
      'jsonReplacer',
      'listField',
      'localize',
      'maxRisk',
      'maxUint',
      'numberField',
      'percentField',
      'plainText',
      'rawField',
      'systemClock',
      'text',
      'textField',
      'warning',
      'warningsAt',
    ])
  })

  test('errors: a stable code, a message, the cause kept', () => {
    const cause = new Error('RLP')
    const error = new api.ClearSignError('INVALID_INPUT', undefined, {cause})
    assert.equal(error.name, 'ClearSignError')
    assert.equal(error.message, 'What is to be signed could not be read.')
    assert.equal(error.cause, cause)
    assert.ok(api.isClearSignError(error))
    assert.ok(api.isClearSignError(error, 'INVALID_INPUT'))
    assert.ok(!api.isClearSignError(error, 'CHAIN_MISMATCH'))
    assert.ok(!api.isClearSignError(cause))
    assert.deepEqual(api.CLEAR_SIGN_ERROR_CODES, ['INVALID_ARGUMENT', 'INVALID_INPUT', 'CHAIN_MISMATCH', 'UNSUPPORTED'])
  })

  test('docs copy has no em dashes: the README and the JSDoc that is the API reference', () => {
    const sources = readdirSync(new URL('../src', import.meta.url)).map(file => read(`../src/${file}`))

    for (const copy of [read('../README.md'), ...sources]) {
      assert.ok(!copy.includes('—'))
    }
  })
})
