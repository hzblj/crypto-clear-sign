import {LABELS, listField, numberField, text} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {createReader, lengthU64, malformed} from '../reader'
import {closeWarning} from './close'
import type {Decoder} from './types'

/**
 * The Address Lookup Table program: creating, extending, freezing, deactivating and closing a table. bincode, a `u32`
 * tag first. A table only lists addresses; what matters is which transactions later load from it.
 */
export const describeLookupTable: Decoder = async (instruction, build) => {
  const reader = createReader(instruction.data)
  const tag = reader.u32()
  const table = () => build.account(0, {id: 'lookupTable', label: SOLANA_TEXTS.label.lookupTable})
  const authority = () => build.account(1, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

  switch (tag) {
    case 0: {
      const slot = reader.u64()
      const bump = reader.u8()
      reader.end()
      const account = await table()
      const owner = await authority()

      return build.finish({
        fields: [
          account.field,
          owner.field,
          numberField({id: 'recentSlot', label: SOLANA_TEXTS.label.recentSlot, secondary: true, value: slot}),
          numberField({id: 'bump', label: SOLANA_TEXTS.label.bump, secondary: true, value: bump}),
        ],
        intent: SOLANA_TEXTS.intent.createLookupTable,
        summary: text(SOLANA_TEXTS.summary.createLookupTable, {account: account.display}),
      })
    }
    case 1:
    case 3: {
      reader.end()
      const account = await table()
      const owner = await authority()

      return build.finish({
        fields: [account.field, owner.field],
        intent: tag === 1 ? SOLANA_TEXTS.intent.freezeLookupTable : SOLANA_TEXTS.intent.deactivateLookupTable,
      })
    }
    case 2: {
      const count = lengthU64(reader, 32)
      const addresses = Array.from({length: count}, () => reader.pubkey())
      reader.end()
      const account = await table()
      const owner = await authority()
      const items = []

      for (const [index, address] of addresses.entries()) {
        items.push((await build.address(address, {id: `address-${index}`, label: LABELS.account})).field)
      }

      return build.finish({
        fields: [account.field, listField({id: 'addresses', items, label: SOLANA_TEXTS.label.addresses}), owner.field],
        intent: SOLANA_TEXTS.intent.extendLookupTable,
        summary: text(SOLANA_TEXTS.summary.extendLookupTable, {account: account.display, count}),
      })
    }
    case 4: {
      reader.end()
      const account = await table()
      const owner = await authority()
      const recipient = await build.account(2, {id: 'recipient', label: LABELS.recipient})

      return build.finish({
        fields: [account.field, recipient.field, owner.field],
        intent: SOLANA_TEXTS.intent.closeLookupTable,
        summary: text(SOLANA_TEXTS.summary.closeAccount, {account: account.display, recipient: recipient.display}),
        warnings: [closeWarning(recipient, owner, ['recipient'])],
      })
    }
    default:
      return malformed()
  }
}
