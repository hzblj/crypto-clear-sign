import {hasHiddenCharacters, LABELS, textField, WARNINGS, warning} from '@hzblj/crypto-clear-sign'

import {SOLANA_TEXTS} from '../catalogs'
import {decodeText, malformed} from '../reader'
import type {Decoder} from './types'

/**
 * The Memo program (v2, and v1): the instruction's data is the note, which the program refuses unless it is UTF-8.
 * Its accounts, if any, are signers the note is signed by. A note with hidden characters is `HIDDEN_CHARACTERS`.
 */
export const describeMemo: Decoder = (instruction, build) => {
  const memo = decodeText(instruction.data) ?? malformed()

  return build.finish({
    fields: [textField({id: 'memo', label: LABELS.message, value: memo})],
    intent: SOLANA_TEXTS.intent.memo,
    rest: 'signer',
    summary: SOLANA_TEXTS.summary.memo,
    warnings: [hasHiddenCharacters(memo) ? warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['memo']}) : undefined],
  })
}
