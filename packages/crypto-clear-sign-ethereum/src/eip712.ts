import type {TypedDataField} from '@hzblj/crypto-ethereum'

const ARRAY = /\[[0-9]*\]$/

/** The struct a member type names, through any array dimensions: `Person[2][]` is `Person`. Internal. */
export const baseType = (type: string): string => {
  let base = type

  while (ARRAY.test(base)) {
    base = base.replace(ARRAY, '')
  }

  return base
}

type Types = {readonly [struct: string]: readonly TypedDataField[] | undefined}

/**
 * EIP-712's `encodeType` of `primaryType`: `Name(type member,…)`, then every struct it references, sorted by name.
 * What an ERC-7730 version 2 descriptor keys a message's format by. Internal: the types were checked by the adapter.
 */
export const encodeType = (types: Types, primaryType: string): string => {
  const found = new Set<string>()
  const collect = (struct: string, depth: number) => {
    if (depth > 64) {
      return
    }

    for (const field of types[struct] ?? []) {
      const child = baseType(field.type)

      if (child !== primaryType && types[child] !== undefined && !found.has(child)) {
        found.add(child)
        collect(child, depth + 1)
      }
    }
  }
  collect(primaryType, 0)

  return [primaryType, ...[...found].sort()]
    .map(struct => `${struct}(${(types[struct] ?? []).map(({name, type}) => `${type} ${name}`).join(',')})`)
    .join('')
}

/** An `encodeType` string with the spacing a hand-written key may add removed: what keys are compared by. Internal. */
export const normalizeEncodeType = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim()
