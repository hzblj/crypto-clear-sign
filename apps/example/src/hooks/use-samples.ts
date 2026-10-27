import {useCallback, useEffect, useState} from 'react'

import {
  type ChainId,
  type DemoAccounts,
  type DemoCrypto,
  type ReviewSettings,
  reviewOptions,
  runSample,
  SAMPLES,
  type SampleOutcome,
} from '../core'
import {useDemo} from './use-demo'
import {useReviewSettings} from './use-settings'

type Run = {readonly now: number; readonly outcomes: Promise<readonly SampleOutcome[]>}

/**
 * Each chain's gallery, reviewed once per settings: the list and a sample's own screen share the same results, made
 * at the same moment. Pull to refresh makes them again.
 */
const runs = new Map<string, Run>()

const keyOf = (chain: ChainId, settings: ReviewSettings) => `${chain}|${JSON.stringify(settings)}`

const runOf = (chain: ChainId, settings: ReviewSettings, crypto: DemoCrypto, accounts: DemoAccounts): Run => {
  const key = keyOf(chain, settings)
  const known = runs.get(key)

  if (known) {
    return known
  }

  const now = Date.now()
  const options = reviewOptions(settings, accounts, now)
  const env = {accounts, crypto, now}
  const run = {now, outcomes: Promise.all(SAMPLES[chain].map(sample => runSample(sample, env, options)))}
  runs.set(key, run)

  return run
}

export type SampleRun = {readonly now: number; readonly outcomes: readonly SampleOutcome[]}

/** The chain's samples reviewed with the current settings: `null` until they are, and a refresh that redoes them. */
export const useSampleOutcomes = (chain: ChainId) => {
  const demo = useDemo()
  const settings = useReviewSettings()
  const [version, setVersion] = useState(0)
  const [run, setRun] = useState<SampleRun | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` only triggers it, after a refresh dropped the run.
  useEffect(() => {
    if (demo.status !== 'ready') {
      return
    }

    let live = true
    const current = runOf(chain, settings, demo.crypto, demo.accounts)
    current.outcomes.then(outcomes => live && setRun({now: current.now, outcomes}))

    return () => {
      live = false
    }
  }, [chain, demo, settings, version])

  const refresh = useCallback(async () => {
    for (const key of runs.keys()) {
      if (key.startsWith(`${chain}|`)) {
        runs.delete(key)
      }
    }

    setVersion(value => value + 1)

    if (demo.status === 'ready') {
      await runOf(chain, settings, demo.crypto, demo.accounts).outcomes
    }
  }, [chain, demo, settings])

  return {demo, refresh, run}
}
