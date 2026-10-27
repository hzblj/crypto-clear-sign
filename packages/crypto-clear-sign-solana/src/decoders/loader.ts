import {INTENTS, LABELS, numberField, rawField, text, warning} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS, SOLANA_WARNINGS} from '../catalogs'
import {createReader, lengthU64, malformed} from '../reader'
import {closeWarning} from './close'
import {handoverWarning} from './system'
import type {Decoder} from './types'

/**
 * The BPF Upgradeable Loader: program buffers, deployment, upgrades (`solana.PROGRAM_UPGRADE`), authorities
 * (`ASSET_OWNERSHIP_TRANSFER` when handed to someone else) and closing. bincode, a `u32` tag first.
 */
export const describeLoader: Decoder = async (instruction, build, scope) => {
  const reader = createReader(instruction.data)
  const tag = reader.u32()

  switch (tag) {
    case 0: {
      reader.end()
      const buffer = await build.account(0, {id: 'buffer', label: SOLANA_TEXTS.label.buffer})
      const authority = await build.optionalAccount(1, {id: 'authority', label: SOLANA_TEXTS.label.authority})

      return build.finish({fields: [buffer.field, authority?.field], intent: SOLANA_TEXTS.intent.createBuffer})
    }
    case 1: {
      const offset = reader.u32()
      const bytes = reader.bytes(lengthU64(reader))
      reader.end()
      const buffer = await build.account(0, {id: 'buffer', label: SOLANA_TEXTS.label.buffer})
      const authority = await build.account(1, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

      return build.finish({
        fields: [
          buffer.field,
          numberField({id: 'offset', label: SOLANA_TEXTS.label.offset, unit: SOLANA_TEXTS.unit.bytes, value: offset}),
          authority.field,
        ],
        intent: SOLANA_TEXTS.intent.writeProgram,
        raw: [rawField({id: 'data', label: LABELS.data, value: bytes})],
      })
    }
    case 2: {
      const length = reader.u64()
      reader.end()
      const program = await build.account(2, {id: 'programAccount', label: LABELS.program})
      const buffer = await build.account(3, {id: 'buffer', label: SOLANA_TEXTS.label.buffer, secondary: true})
      const authority = await build.account(7, {id: 'authority', label: SOLANA_TEXTS.label.authority})
      const payer = await build.account(0, {id: 'from', label: LABELS.from, secondary: true})

      return build.finish({
        fields: [
          program.field,
          authority.field,
          numberField({
            id: 'maxDataLength',
            label: SOLANA_TEXTS.label.maxDataLength,
            unit: SOLANA_TEXTS.unit.bytes,
            value: length,
          }),
          buffer.field,
          payer.field,
        ],
        intent: INTENTS.deploy,
        summary: text(SOLANA_TEXTS.summary.deployProgram, {program: program.display}),
      })
    }
    case 3: {
      reader.end()
      const program = await build.account(1, {id: 'programAccount', label: LABELS.program})
      const buffer = await build.account(2, {id: 'buffer', label: SOLANA_TEXTS.label.buffer})
      const spill = await build.account(3, {id: 'spill', label: SOLANA_TEXTS.label.spill, secondary: true})
      const authority = await build.account(6, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})

      return build.finish({
        fields: [program.field, buffer.field, authority.field, spill.field],
        intent: SOLANA_TEXTS.intent.upgradeProgram,
        summary: text(SOLANA_TEXTS.summary.upgradeProgram, {program: program.display}),
        warnings: [warning(SOLANA_WARNINGS.PROGRAM_UPGRADE, {fields: ['programAccount', 'buffer']})],
      })
    }
    case 4:
    case 7: {
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const current = await build.account(1, {id: 'authority', label: SOLANA_TEXTS.label.authority, secondary: true})
      // Clients fill a left-out optional account with the loader itself, a key nobody holds: no authority either way.
      const absent = tag === 4 && instruction.accounts[2]?.address === instruction.programId
      const next = absent
        ? undefined
        : await (tag === 7
            ? build.account(2, {id: 'newAuthority', label: SOLANA_TEXTS.label.newAuthority})
            : build.optionalAccount(2, {id: 'newAuthority', label: SOLANA_TEXTS.label.newAuthority}))

      if (next === undefined) {
        return build.finish({
          fields: [account.field, current.field],
          intent: SOLANA_TEXTS.intent.makeImmutable,
          summary: text(SOLANA_TEXTS.summary.makeImmutable, {account: account.display}),
        })
      }

      const handover = handoverWarning(scope, current, next, ['newAuthority', 'account'])

      return build.finish({
        fields: [next.field, account.field, current.field],
        intent: handover === undefined ? SOLANA_TEXTS.intent.setProgramAuthority : INTENTS.transferOwnership,
        summary: text(SOLANA_TEXTS.summary.setProgramAuthority, {account: account.display, authority: next.display}),
        warnings: [handover],
      })
    }
    case 5: {
      reader.end()
      const account = await build.account(0, {id: 'account', label: LABELS.account})
      const recipient = await build.account(1, {id: 'recipient', label: LABELS.recipient})
      const authority = await build.optionalAccount(2, {
        id: 'authority',
        label: SOLANA_TEXTS.label.authority,
        secondary: true,
      })

      return build.finish({
        fields: [account.field, recipient.field, authority?.field],
        intent: SOLANA_TEXTS.intent.closeProgram,
        summary: text(SOLANA_TEXTS.summary.closeAccount, {account: account.display, recipient: recipient.display}),
        warnings: [closeWarning(recipient, authority, ['recipient'])],
      })
    }
    case 6: {
      const additional = reader.u32()
      reader.end()
      const program = await build.account(1, {id: 'programAccount', label: LABELS.program})

      return build.finish({
        fields: [
          program.field,
          numberField({
            id: 'additionalBytes',
            label: SOLANA_TEXTS.label.additionalBytes,
            unit: SOLANA_TEXTS.unit.bytes,
            value: additional,
          }),
        ],
        intent: SOLANA_TEXTS.intent.extendProgram,
      })
    }
    default:
      return malformed()
  }
}
