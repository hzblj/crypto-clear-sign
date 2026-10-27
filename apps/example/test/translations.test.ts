import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {INTENTS, isSharedWarningCode, LABELS, localize, plainText, SUMMARIES} from '@hzblj/crypto-clear-sign'

import {CZECH, RISK_LABELS, translationsFor} from '../src/config/translations'
import {sampleOf} from '../src/core/samples'
import {reviewed} from './support'

const TEXTS: ReadonlyMap<string, string> = new Map(
  [...Object.values(INTENTS), ...Object.values(SUMMARIES), ...Object.values(LABELS)].map(entry => [
    entry.code,
    entry.text,
  ])
)

const placeholders = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('the Czech table', () => {
  test('every key is one of the library`s shared codes, and a summary keeps its English params', () => {
    for (const [code, czech] of Object.entries(CZECH)) {
      const english = TEXTS.get(code)
      assert.ok(english !== undefined || isSharedWarningCode(code), `${code} is a shared code`)

      if (english !== undefined) {
        assert.deepEqual(placeholders(czech), placeholders(english), code)
      }
    }
  })

  test('localize translates by code with the same params, and leaves the rest in English', async () => {
    const sample = sampleOf('ethereum', 'unlimited-approve')
    assert.ok(sample)
    const {result} = await reviewed(sample)
    const translations = translationsFor('cs')
    assert.ok(result.summary)

    assert.equal(localize(result.intent, translations), 'Schválit')
    assert.equal(localize(result.summary, translations), 'Povolit Permit2 utratit neomezené množství USDC')
    assert.equal(localize(result.summary, translationsFor('en')), result.summary.text)
    assert.match(localize(result.warnings[0] ?? result.intent, translations), /Oprávněný/)
    assert.match(plainText(result, {translations}), /^Schválit: Povolit Permit2/)
  })

  test('a descriptor`s words are external and stay as they are', async () => {
    const sample = sampleOf('ethereum', 'uniswap-swap')
    assert.ok(sample)
    const {result} = await reviewed(sample)

    assert.equal(result.intent.code, 'external')
    assert.equal(localize(result.intent, {...CZECH, external: 'Nikdy'}), result.intent.text)
  })

  test('every risk level has a word in both languages', () => {
    for (const labels of Object.values(RISK_LABELS)) {
      assert.deepEqual(Object.keys(labels).sort(), ['critical', 'high', 'info', 'low', 'medium', 'none'])
    }
  })
})
