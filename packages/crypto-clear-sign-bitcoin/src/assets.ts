// Coins that hold inscriptions or runes, as the app's indexer says, and where a transaction sends what they hold:
// inscriptions ride their sats, first in first out (ordinal theory), runes follow the runestone (see runes.ts).

import type {BitcoinPsbt} from '@hzblj/crypto-bitcoin'
import type {ChainRef} from '@hzblj/crypto-clear-sign'

import type {BitcoinAssetResolver, BitcoinClearSignOptions, BitcoinCoinAssets} from './options'
import {type Artifact, runeDestinations} from './runes'

const INSCRIPTION_ID = /^[0-9a-f]{64}i\d{1,10}$/
const RUNE_ID = /^\d{1,20}:\d{1,10}$/
const MAX_ITEMS = 1000

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

const list = (value: unknown): readonly unknown[] => {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new TypeError('Not a list of assets.')
  }

  return value
}

const isCount = (value: unknown) =>
  typeof value === 'bigint' ? value >= 0n : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** A resolver's answer, checked and copied: anything malformed throws, and counts as a failure. */
const checkAssets = (value: unknown): BitcoinCoinAssets | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (!isPlainObject(value)) {
    throw new TypeError('Not a coin`s assets.')
  }

  const inscriptions = list(value.inscriptions).map(item => {
    if (
      !isPlainObject(item) ||
      (item.id !== undefined && (typeof item.id !== 'string' || !INSCRIPTION_ID.test(item.id))) ||
      (item.offset !== undefined && !isCount(item.offset))
    ) {
      throw new TypeError('Not an inscription.')
    }

    return Object.freeze({
      ...(item.id === undefined ? {} : {id: item.id as string}),
      ...(item.offset === undefined ? {} : {offset: BigInt(item.offset as bigint | number)}),
    })
  })
  const runes = list(value.runes).map(item => {
    if (
      !isPlainObject(item) ||
      (item.id !== undefined && (typeof item.id !== 'string' || !RUNE_ID.test(item.id))) ||
      (item.amount !== undefined && (typeof item.amount !== 'bigint' || item.amount < 0n))
    ) {
      throw new TypeError('Not a rune balance.')
    }

    return Object.freeze({
      ...(item.id === undefined ? {} : {id: item.id as string}),
      ...(item.amount === undefined ? {} : {amount: item.amount as bigint}),
    })
  })

  return inscriptions.length === 0 && runes.length === 0
    ? undefined
    : Object.freeze({inscriptions: Object.freeze(inscriptions), runes: Object.freeze(runes)})
}

const isResolver = (assets: BitcoinClearSignOptions['assets']): assets is BitcoinAssetResolver =>
  typeof (assets as BitcoinAssetResolver | undefined)?.assets === 'function'

/**
 * What each input's coin holds, by the `assets` option (a resolver, or a record keyed `txid:vout`), and whether the
 * resolver failed (threw, rejected, or answered with something malformed) for any of them.
 */
export const lookUpAssets = async (
  assets: BitcoinClearSignOptions['assets'],
  chain: ChainRef,
  psbt: BitcoinPsbt
): Promise<{readonly coins: readonly (BitcoinCoinAssets | undefined)[]; readonly failed: boolean}> => {
  if (assets === undefined) {
    return {coins: psbt.inputs.map(() => undefined), failed: false}
  }

  let failed = false
  const coins = await Promise.all(
    psbt.inputs.map(async ({txid, vout}) => {
      try {
        const answer = isResolver(assets)
          ? await assets.assets({chain, txid, vout})
          : Object.hasOwn(assets, `${txid}:${vout}`)
            ? assets[`${txid}:${vout}`]
            : undefined

        return checkAssets(answer)
      } catch {
        failed = true

        return undefined
      }
    })
  )

  return {coins, failed}
}

/** Where what one input's coin holds may go. */
export type AssetFlow = {
  readonly input: number
  /** The outputs it may reach (an `OP_RETURN` one burns it). */
  readonly outputs: ReadonlySet<number>
  /** Some of it may go to the fee: the miner's. */
  readonly fee: boolean
  /** Some of it may be burned without reaching an output (a cenotaph, or no output to take runes). */
  readonly burned: boolean
  /** Where it goes cannot be worked out: a coin's value is missing. */
  readonly unknown: boolean
}

/**
 * Where an input's inscriptions and runes go. An inscription is on a sat: the sats of every input, in order, fill the
 * outputs in order, and what is left over is the fee. Without an offset, every sat of the coin counts. Runes follow
 * `runeDestinations`.
 */
export const assetFlow = (
  psbt: BitcoinPsbt,
  input: number,
  assets: BitcoinCoinAssets,
  artifact: Artifact | undefined
): AssetFlow => {
  const outputs = new Set<number>()
  let fee = false
  let burned = false
  let unknown = false

  if ((assets.inscriptions ?? []).length > 0) {
    const values = psbt.inputs.slice(0, input + 1).map(entry => entry.spent?.value)

    if (values.some(value => value === undefined)) {
      unknown = true
    } else {
      const start = (values as bigint[]).slice(0, -1).reduce((sum, value) => sum + value, 0n)
      const value = values[values.length - 1] ?? 0n

      for (const inscription of assets.inscriptions ?? []) {
        const offset = inscription.offset === undefined ? undefined : BigInt(inscription.offset)
        const [from, to] =
          offset !== undefined && offset < value ? [start + offset, start + offset + 1n] : [start, start + value]
        let position = 0n

        for (const [index, output] of psbt.outputs.entries()) {
          const end = position + output.value

          if (from < end && to > position) {
            outputs.add(index)
          }

          position = end
        }

        if (to > position) {
          fee = true
        }
      }
    }
  }

  if ((assets.runes ?? []).length > 0) {
    const ids = (assets.runes ?? []).every(rune => rune.id !== undefined)
      ? new Set((assets.runes ?? []).map(rune => rune.id as string))
      : undefined
    const runes = runeDestinations(
      artifact,
      psbt.outputs.map(output => output.scriptPubKey),
      ids
    )

    for (const output of runes.outputs) {
      outputs.add(output)
    }

    burned ||= runes.burned
  }

  return {burned, fee, input, outputs, unknown}
}
