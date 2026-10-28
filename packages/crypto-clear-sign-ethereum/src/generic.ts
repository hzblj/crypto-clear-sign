import {
  booleanField,
  type DisplayText,
  externalText,
  type Field,
  listField,
  numberField,
  rawField,
  text,
  textField,
} from '@hzblj/crypto-clear-sign'

import type {AbiValue} from './abi'
import {ETHEREUM_TEXTS} from './catalogs'
import type {Env} from './env'

/** How many items of an array are shown. */
const MAX_ITEMS = 256

/**
 * Any decoded value as a field, as it is: numbers, addresses (named), booleans, bytes, text, lists. `onText` sees
 * every text shown, for the hidden character check. Internal.
 */
export const genericField = async (
  env: Env,
  input: {readonly id: string; readonly label: DisplayText; readonly value: AbiValue; readonly secondary?: boolean},
  onText: (id: string, words: string) => void,
  depth = 0
): Promise<Field> => {
  const {id, label, value} = input
  const common = {id, label, ...(input.secondary === true ? {secondary: true} : {})}

  switch (value.kind) {
    case 'uint':
    case 'int':
      return numberField({...common, value: value.value})
    case 'address':
      return env.address({...common, value: value.value})
    case 'bool':
      return booleanField({...common, value: value.value})
    case 'bytes':
      return rawField({...common, value: value.value})
    case 'string':
      onText(id, value.value)

      return textField({...common, value: value.value})
    case 'array':
    case 'tuple': {
      if (depth > 8) {
        return textField({...common, value: '…'})
      }

      const entries =
        value.kind === 'array'
          ? value.items.slice(0, MAX_ITEMS).map((item, index) => ({
              label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
              part: String(index),
              value: item,
            }))
          : value.fields.map((field, index) => ({
              label: externalText(field.name ?? String(index)),
              part: field.name ?? String(index),
              value: field.value,
            }))
      const items: Field[] = []

      for (const entry of entries) {
        items.push(
          await genericField(
            env,
            {id: `${id}.${entry.part}`.slice(0, 128), label: entry.label, value: entry.value},
            onText,
            depth + 1
          )
        )
      }

      return listField({...common, items})
    }
  }
}
