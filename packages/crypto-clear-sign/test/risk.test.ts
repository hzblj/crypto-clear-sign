import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  compareRisk,
  isClearSignError,
  isRiskLevel,
  isSeverity,
  maxRisk,
  RISK_LEVELS,
  type RiskLevel,
  SEVERITIES,
  WARNINGS,
  warning,
} from '../src'

describe('risk', () => {
  test('severities and risk levels, least to most serious', () => {
    assert.deepEqual(SEVERITIES, ['info', 'low', 'medium', 'high', 'critical'])
    assert.deepEqual(RISK_LEVELS, ['none', 'info', 'low', 'medium', 'high', 'critical'])

    for (let index = 1; index < RISK_LEVELS.length; index++) {
      assert.ok(compareRisk(RISK_LEVELS[index - 1] as RiskLevel, RISK_LEVELS[index] as RiskLevel) < 0)
      assert.ok(compareRisk(RISK_LEVELS[index] as RiskLevel, RISK_LEVELS[index - 1] as RiskLevel) > 0)
    }

    assert.equal(compareRisk('high', 'high'), 0)
  })

  test('type guards', () => {
    assert.ok(SEVERITIES.every(isSeverity))
    assert.ok(!isSeverity('none'))
    assert.ok(!isSeverity('severe'))
    assert.ok(!isSeverity(3))
    assert.ok(RISK_LEVELS.every(isRiskLevel))
    assert.ok(!isRiskLevel('HIGH'))
    assert.ok(!isRiskLevel(undefined))
  })

  test('maxRisk: none for nothing, else the most serious of levels and warnings mixed', () => {
    assert.equal(maxRisk([]), 'none')
    assert.equal(maxRisk(['none']), 'none')
    assert.equal(maxRisk(['info']), 'info')
    assert.equal(maxRisk(['low', 'critical', 'medium']), 'critical')
    assert.equal(
      maxRisk([warning(WARNINGS.UNKNOWN_DESTINATION), 'medium', warning(WARNINGS.RESOLVER_FAILED)]),
      'medium'
    )
    assert.equal(maxRisk(new Set<RiskLevel>(['high', 'low'])), 'high')
    assert.throws(
      () => maxRisk(['severe' as RiskLevel]),
      error => isClearSignError(error, 'INVALID_ARGUMENT')
    )
  })
})
