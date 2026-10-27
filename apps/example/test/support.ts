import assert from 'node:assert/strict'

import type {ClearSigning, ClearSigningAction, Field} from '@hzblj/crypto-clear-sign'
import {findField} from '@hzblj/crypto-clear-sign'
import {createTestCryptoEngine} from '@hzblj/nitro-crypto/testing'

import {createDemoAdapters, type DemoAccounts, type DemoCrypto, openDemoAccounts} from '../src/core/chains'
import {DEFAULT_SETTINGS, type ReviewSettings, reviewOptions} from '../src/core/options'
import {runSample, type Sample, type SampleEnv, type SampleOutcome} from '../src/core/samples'

/** 2026-10-27T12:00:00Z: the moment every sample is built and read at. */
export const NOW = Date.UTC(2026, 9, 27, 12)

/** Resolvers off and the chain packages' built-in lists off: what the bytes alone say. */
export const OFFLINE: ReviewSettings = {...DEFAULT_SETTINGS, builtins: false, resolvers: false}

type Setup = {readonly crypto: DemoCrypto; readonly accounts: DemoAccounts; readonly env: SampleEnv}

let setup: Promise<Setup> | undefined

/** The engine (WebAssembly) and the demo key's accounts, made once for every test file that asks. */
export const demo = (): Promise<Setup> => {
  setup ??= (async () => {
    const crypto = createTestCryptoEngine({adapters: createDemoAdapters()})
    const accounts = await openDemoAccounts(crypto)

    return {accounts, crypto, env: {accounts, crypto, now: NOW}}
  })()

  return setup
}

/** A sample reviewed with `settings`; it must give a result. */
export const reviewed = async (
  sample: Sample,
  settings: ReviewSettings = DEFAULT_SETTINGS
): Promise<Extract<SampleOutcome, {readonly result: ClearSigning}>> => {
  const {accounts, env} = await demo()
  const outcome = await runSample(sample, env, reviewOptions(settings, accounts, NOW))

  if ('error' in outcome) {
    throw outcome.error
  }

  return outcome
}

/** The codes of every warning, sorted: what a test compares. */
export const codes = (result: ClearSigning) => result.warnings.map(entry => entry.code).sort()

export const field = <Kind extends Field['kind']>(action: ClearSigningAction, id: string, kind: Kind) => {
  const found = findField(action, id)
  assert.ok(found, `field ${id}`)
  assert.equal(found.kind, kind, `field ${id} is ${kind}`)

  return found as Extract<Field, {readonly kind: Kind}>
}

export const actionOf = (result: ClearSigning, index: number): ClearSigningAction => {
  const action = result.actions[index]
  assert.ok(action, `action ${index}`)

  return action
}
