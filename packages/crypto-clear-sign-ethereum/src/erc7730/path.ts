import type {AbiValue} from '../abi'

/** One step of a path: a member, an array element (negative counts from the end), a slice, or every element. */
export type PathStep =
  | {readonly kind: 'field'; readonly name: string}
  | {readonly kind: 'index'; readonly index: number}
  | {readonly kind: 'slice'; readonly start?: number; readonly end?: number}
  | {readonly kind: 'all'}

/**
 * An ERC-7730 path: `#.` (or no root) the data signed, `@.` the container (`from`, `to`, `value`, `chainId`), `$.` the
 * descriptor itself. Array steps are written `.[0]`, `.[-1]`, `.[1:3]`, `.[]`, or without the dot (`path[0]`).
 */
export type Path = {
  readonly root: 'data' | 'container' | 'descriptor'
  /** Whether a data path is absolute (`#.`), so that a group's path does not prefix it. */
  readonly absolute: boolean
  readonly steps: readonly PathStep[]
}

export const CONTAINER_FIELDS = ['from', 'to', 'value', 'chainId'] as const

const MAX_PATH_LENGTH = 256

const NAME = /^[A-Za-z0-9_$]+$/

const INTEGER = /^-?[0-9]{1,6}$/

/** A path parsed, or `undefined` when it is not one. */
export const parsePath = (text: unknown): Path | undefined => {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PATH_LENGTH) {
    return undefined
  }

  const root = text.startsWith('@.') ? 'container' : text.startsWith('$.') ? 'descriptor' : 'data'
  const absolute = root !== 'data' || text.startsWith('#.')
  const body = absolute ? text.slice(2) : text
  const steps: PathStep[] = []

  // `a.b[0]` and `a.b.[0]` alike: split at dots and before each bracket.
  for (const part of body.replace(/([^.])\[/g, '$1.[').split('.')) {
    if (NAME.test(part)) {
      steps.push({kind: 'field', name: part})
      continue
    }

    const bracket = /^\[(.*)\]$/.exec(part)

    if (!bracket) {
      return undefined
    }

    const inside = bracket[1] ?? ''

    if (inside === '') {
      steps.push({kind: 'all'})
    } else if (INTEGER.test(inside)) {
      steps.push({index: Number(inside), kind: 'index'})
    } else {
      const slice = /^(-?[0-9]{1,6})?:(-?[0-9]{1,6})?$/.exec(inside)

      if (!slice) {
        return undefined
      }

      steps.push({
        kind: 'slice',
        ...(slice[1] === undefined ? {} : {start: Number(slice[1])}),
        ...(slice[2] === undefined ? {} : {end: Number(slice[2])}),
      })
    }
  }

  if (steps.length === 0) {
    return undefined
  }

  if (root === 'container') {
    const [first] = steps

    if (
      steps.length !== 1 ||
      first?.kind !== 'field' ||
      !(CONTAINER_FIELDS as readonly string[]).includes(first.name)
    ) {
      return undefined
    }
  }

  return {absolute, root, steps}
}

/** A data path written out with concrete indexes, as field ids and interpolation keys use it: `details.0.amount`. */
export const pathText = (path: Path): string =>
  `${path.root === 'container' ? '@.' : path.root === 'descriptor' ? '$.' : ''}${path.steps
    .map(step => {
      switch (step.kind) {
        case 'field':
          return step.name
        case 'index':
          return `[${step.index}]`
        case 'slice':
          return `[${step.start ?? ''}:${step.end ?? ''}]`
        case 'all':
          return '[]'
      }
    })
    .join('.')}`

/** `inner` read under `outer` (a group's path), unless it is absolute. */
export const joinPath = (outer: Path | undefined, inner: Path): Path =>
  outer === undefined || inner.absolute || outer.root !== 'data'
    ? inner
    : {absolute: outer.absolute, root: 'data', steps: [...outer.steps, ...inner.steps]}

/** A value a data path reached, and the concrete steps that reached it. */
export type Located = {
  readonly value: AbiValue
  /** Member names and element indexes: `['details', 0, 'amount']`. */
  readonly at: readonly (string | number)[]
}

const toBytes = (value: AbiValue): Uint8Array | undefined => {
  switch (value.kind) {
    case 'bytes':
      return value.value
    case 'string':
      return value.bytes
    case 'address': {
      const out = new Uint8Array(20)

      for (let index = 0; index < 20; index++) {
        out[index] = Number.parseInt(value.value.slice(2 + 2 * index, 4 + 2 * index), 16)
      }

      return out
    }
    case 'uint':
    case 'int': {
      // The 32-byte word the value is in the ABI: two's complement for a negative int.
      let rest = value.value < 0n ? (1n << 256n) + value.value : value.value
      const out = new Uint8Array(32)

      for (let index = 31; index >= 0; index--) {
        out[index] = Number(rest & 0xffn)
        rest >>= 8n
      }

      return out
    }
    default:
      return undefined
  }
}

const bound = (index: number, length: number) => Math.min(Math.max(index < 0 ? length + index : index, 0), length)

/** How many values one path may reach: a descriptor cannot make the review list a million rows. */
export const MAX_LOCATED = 256

/**
 * The values a data path reaches in `root` (the decoded arguments or message, as a tuple): none when a member is
 * missing or an index is out of range, several through `[]` and slices of arrays. A slice of bytes, text or an
 * integer's 32-byte word is bytes. Throws nothing.
 */
export const locate = (root: AbiValue, steps: readonly PathStep[]): Located[] => {
  let current: Located[] = [{at: [], value: root}]

  for (const step of steps) {
    const next: Located[] = []

    for (const {at, value} of current) {
      if (step.kind === 'field') {
        const found = value.kind === 'tuple' ? value.fields.find(field => field.name === step.name) : undefined

        if (found !== undefined) {
          next.push({at: [...at, step.name], value: found.value})
        }
      } else if (value.kind === 'array') {
        const {items} = value

        if (step.kind === 'index') {
          const index = step.index < 0 ? items.length + step.index : step.index
          const item = items[index]

          if (item !== undefined && index >= 0) {
            next.push({at: [...at, index], value: item})
          }
        } else {
          const start = step.kind === 'slice' && step.start !== undefined ? bound(step.start, items.length) : 0
          const end = step.kind === 'slice' && step.end !== undefined ? bound(step.end, items.length) : items.length

          for (let index = start; index < end && next.length < MAX_LOCATED; index++) {
            next.push({at: [...at, index], value: items[index] as AbiValue})
          }
        }
      } else if (step.kind === 'slice') {
        const bytes = toBytes(value)

        if (bytes !== undefined) {
          const start = step.start === undefined ? 0 : bound(step.start, bytes.length)
          const end = step.end === undefined ? bytes.length : bound(step.end, bytes.length)
          next.push({at, value: {kind: 'bytes', value: bytes.slice(start, Math.max(start, end))}})
        }
      }
    }

    current = next.slice(0, MAX_LOCATED)
  }

  return current
}

/** The concrete path of a located value, as a field id's tail: `details.0.amount`. */
export const atText = (at: readonly (string | number)[]): string => at.join('.')
