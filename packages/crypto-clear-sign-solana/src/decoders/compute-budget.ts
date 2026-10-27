import {numberField, text} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {createReader, malformed} from '../reader'
import type {Decoder} from './types'

/** What a transaction's Compute Budget instructions set: the first of each kind, as the runtime takes it. */
export type ComputeBudget = {readonly limit?: number; readonly price?: bigint}

/** `SetComputeUnitLimit` (2) and `SetComputeUnitPrice` (3), read from instruction data; anything else is skipped. */
export const readComputeBudget = (data: Uint8Array): ComputeBudget => {
  try {
    const reader = createReader(data)
    const tag = reader.u8()

    if (tag === 2) {
      const limit = reader.u32()
      reader.end()

      return {limit}
    }

    if (tag === 3) {
      const price = reader.u64()
      reader.end()

      return {price}
    }
  } catch {
    // Not a limit or a price: the decoder shows it.
  }

  return {}
}

/**
 * The Compute Budget program: the compute unit limit and price (the priority fee: the transaction adds them up as
 * its `priorityFee`), the heap size and the loaded accounts' data size limit. A `u8` tag, then the value.
 */
export const describeComputeBudget: Decoder = (instruction, build) => {
  const reader = createReader(instruction.data)
  const tag = reader.u8()

  switch (tag) {
    case 1: {
      const bytes = reader.u32()
      reader.end()

      return build.finish({
        fields: [
          numberField({
            id: 'heapSize',
            label: SOLANA_TEXTS.label.heapSize,
            unit: SOLANA_TEXTS.unit.bytes,
            value: bytes,
          }),
        ],
        intent: SOLANA_TEXTS.intent.requestHeapFrame,
      })
    }
    case 2: {
      const units = reader.u32()
      reader.end()

      return build.finish({
        fields: [
          numberField({
            id: 'computeUnitLimit',
            label: SOLANA_TEXTS.label.computeUnitLimit,
            unit: SOLANA_TEXTS.unit.computeUnits,
            value: units,
          }),
        ],
        intent: SOLANA_TEXTS.intent.setComputeUnitLimit,
        summary: text(SOLANA_TEXTS.summary.setComputeUnitLimit, {units: String(units)}),
      })
    }
    case 3: {
      const price = reader.u64()
      reader.end()

      return build.finish({
        fields: [
          numberField({
            id: 'computeUnitPrice',
            label: SOLANA_TEXTS.label.computeUnitPrice,
            unit: SOLANA_TEXTS.unit.microLamports,
            value: price,
          }),
        ],
        intent: SOLANA_TEXTS.intent.setComputeUnitPrice,
        summary: text(SOLANA_TEXTS.summary.setComputeUnitPrice, {price: price.toString()}),
      })
    }
    case 4: {
      const bytes = reader.u32()
      reader.end()

      return build.finish({
        fields: [
          numberField({
            id: 'dataSizeLimit',
            label: SOLANA_TEXTS.label.dataSizeLimit,
            unit: SOLANA_TEXTS.unit.bytes,
            value: bytes,
          }),
        ],
        intent: SOLANA_TEXTS.intent.setLoadedAccountsDataSizeLimit,
      })
    }
    default:
      return malformed()
  }
}
