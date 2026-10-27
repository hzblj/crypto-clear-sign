// Runestones, as ord (crates/ordinals/src/runestone.rs, the Runes specification's reference) deciphers them: the first
// output whose script is OP_RETURN OP_13, its data pushes concatenated, read as LEB128 integers of up to 128 bits, then
// as tag/value pairs up to the body tag, after which come edicts of four integers each. Anything malformed is a
// cenotaph, which burns every rune the transaction's inputs hold. The adapter has no reader for this; it is ours.

import {concatBytes, instructions, isOpReturn, OP_RETURN} from './bytes'

/** OP_13, which follows OP_RETURN in a runestone's output. */
const MAGIC = 0x5d

const U128_MAX = (1n << 128n) - 1n
const U64_MAX = (1n << 64n) - 1n
const U32_MAX = (1n << 32n) - 1n

const TAG = {
  amount: 10n,
  body: 0n,
  cap: 8n,
  divisibility: 1n,
  flags: 2n,
  heightEnd: 14n,
  heightStart: 12n,
  mint: 20n,
  offsetEnd: 18n,
  offsetStart: 16n,
  pointer: 22n,
  premine: 6n,
  rune: 4n,
  spacers: 3n,
  symbol: 5n,
} as const

const FLAG_ETCHING = 1n << 0n
const FLAG_TERMS = 1n << 1n
const FLAG_TURBO = 1n << 2n

/** The largest divisibility an etching may have, and the spacers' 27 bits. */
export const MAX_DIVISIBILITY = 38
const MAX_SPACERS = 0x07ff_ffffn

/** ord's flaws, kebab-case: why a runestone is a cenotaph. Stable identifiers, shown in a cenotaph's `flaw` field. */
export type RunestoneFlaw =
  | 'edict-output'
  | 'edict-rune-id'
  | 'invalid-script'
  | 'opcode'
  | 'supply-overflow'
  | 'trailing-integers'
  | 'truncated-field'
  | 'unrecognized-even-tag'
  | 'unrecognized-flag'
  | 'varint'

/** A rune's id: the block it was etched in and the transaction's index in that block, `840000:3`. */
export type RuneId = {readonly block: bigint; readonly tx: bigint}

export type Edict = {
  readonly id: RuneId
  /** Base units; 0 means every unit of the rune not yet allocated. */
  readonly amount: bigint
  /** An output index; the number of outputs means split among every output that is not `OP_RETURN`. */
  readonly output: number
}

export type Terms = {
  readonly amount?: bigint
  readonly cap?: bigint
  readonly heightStart?: bigint
  readonly heightEnd?: bigint
  readonly offsetStart?: bigint
  readonly offsetEnd?: bigint
}

export type Etching = {
  readonly divisibility?: number
  readonly premine?: bigint
  /** The rune's name as a number (see `runeName`); `undefined` when the name is left to be assigned. */
  readonly rune?: bigint
  readonly spacers?: number
  readonly symbol?: string
  readonly terms?: Terms
  readonly turbo: boolean
}

export type Runestone = {
  readonly kind: 'runestone'
  /** The output it is in. */
  readonly output: number
  readonly edicts: readonly Edict[]
  readonly etching?: Etching
  readonly mint?: RuneId
  readonly pointer?: number
}

export type Cenotaph = {
  readonly kind: 'cenotaph'
  readonly output: number
  readonly flaw: RunestoneFlaw
  /** The rune an etching named: etched, with nothing to mint. */
  readonly etching?: bigint
  readonly mint?: RuneId
}

export type Artifact = Runestone | Cenotaph

type Payload = {readonly output: number} & ({readonly payload: Uint8Array} | {readonly flaw: RunestoneFlaw})

/** The runestone's output and its data, or `undefined` when no output starts with OP_RETURN OP_13. */
const findPayload = (scripts: readonly Uint8Array[]): Payload | undefined => {
  for (const [output, script] of scripts.entries()) {
    // OP_RETURN scripts may be malformed after their first two opcodes, which alone decide whether it is one.
    if (!isRunestoneScript(script)) {
      continue
    }

    const rest = instructions(script.subarray(2))

    if (rest === undefined) {
      return {flaw: 'invalid-script', output}
    }

    const parts: Uint8Array[] = []

    for (const instruction of rest) {
      if ('op' in instruction) {
        return {flaw: 'opcode', output}
      }

      parts.push(instruction.push)
    }

    return {output, payload: concatBytes(parts)}
  }

  return undefined
}

/**
 * A LEB128 integer of at most 128 bits from `bytes` at `offset`: its value and how many bytes it took, or `undefined`
 * when it is unterminated, longer than 19 bytes, or overflows 128 bits.
 */
export const decodeVarint = (bytes: Uint8Array, offset = 0): {value: bigint; length: number} | undefined => {
  let value = 0n

  for (let index = 0; offset + index < bytes.length; index++) {
    if (index > 18) {
      return undefined
    }

    const byte = bytes[offset + index] ?? 0
    const part = BigInt(byte & 0x7f)

    if (index === 18 && (part & 0b0111_1100n) !== 0n) {
      return undefined
    }

    value |= part << BigInt(7 * index)

    if ((byte & 0x80) === 0) {
      return {length: index + 1, value}
    }
  }

  return undefined
}

const integers = (payload: Uint8Array): bigint[] | undefined => {
  const out: bigint[] = []
  let offset = 0

  while (offset < payload.length) {
    const decoded = decodeVarint(payload, offset)

    if (decoded === undefined) {
      return undefined
    }

    out.push(decoded.value)
    offset += decoded.length
  }

  return out
}

/** `RuneId::new`: block 0 is the rune etched here, which has no transaction index. */
const runeId = (block: bigint, tx: bigint): RuneId | undefined =>
  block > U64_MAX || tx > U32_MAX || (block === 0n && tx > 0n) ? undefined : {block, tx}

/** `RuneId::next`: an edict's id is a delta from the previous edict's. */
const nextId = (previous: RuneId, block: bigint, tx: bigint): RuneId | undefined => {
  if (block > U64_MAX || tx > U32_MAX) {
    return undefined
  }

  const nextBlock = previous.block + block

  if (nextBlock > U64_MAX) {
    return undefined
  }

  return runeId(nextBlock, block === 0n ? previous.tx + tx : tx)
}

/**
 * Takes `count` values of `tag` when `read` accepts them, as ord's `Tag::take`: values it refuses stay, and an even
 * tag left over makes a cenotaph.
 */
const take = <T>(
  fields: Map<bigint, bigint[]>,
  tag: bigint,
  count: number,
  read: (values: bigint[]) => T | undefined
): T | undefined => {
  const queue = fields.get(tag)

  if (queue === undefined || queue.length < count) {
    return undefined
  }

  const value = read(queue.slice(0, count))

  if (value === undefined) {
    return undefined
  }

  queue.splice(0, count)

  if (queue.length === 0) {
    fields.delete(tag)
  }

  return value
}

const single = (values: bigint[]) => values[0] ?? 0n

const upTo = (limit: bigint) => (values: bigint[]) => (single(values) <= limit ? single(values) : undefined)

/**
 * The transaction's runestone or cenotaph, deciphered from its output scripts exactly as ord does; `undefined` when
 * it has none. Never throws: whatever the bytes, the answer is one of the three.
 */
export const decipher = (scripts: readonly Uint8Array[]): Artifact | undefined => {
  const found = findPayload(scripts)

  if (found === undefined) {
    return undefined
  }

  const {output} = found

  if ('flaw' in found) {
    return {flaw: found.flaw, kind: 'cenotaph', output}
  }

  const values = integers(found.payload)

  if (values === undefined) {
    return {flaw: 'varint', kind: 'cenotaph', output}
  }

  const fields = new Map<bigint, bigint[]>()
  const edicts: Edict[] = []
  let flaw: RunestoneFlaw | undefined

  for (let index = 0; index < values.length; index += 2) {
    const tag = values[index] ?? 0n

    if (tag === TAG.body) {
      let id: RuneId = {block: 0n, tx: 0n}

      for (let chunk = index + 1; chunk < values.length; chunk += 4) {
        if (chunk + 4 > values.length) {
          flaw ??= 'trailing-integers'
          break
        }

        const [block = 0n, tx = 0n, amount = 0n, target = 0n] = values.slice(chunk, chunk + 4)
        const next = nextId(id, block, tx)

        if (next === undefined) {
          flaw ??= 'edict-rune-id'
          break
        }

        if (target > BigInt(scripts.length)) {
          flaw ??= 'edict-output'
          break
        }

        id = next
        edicts.push({amount, id: next, output: Number(target)})
      }

      break
    }

    const value = values[index + 1]

    if (value === undefined) {
      flaw ??= 'truncated-field'
      break
    }

    fields.set(tag, [...(fields.get(tag) ?? []), value])
  }

  let flags = take(fields, TAG.flags, 1, single) ?? 0n
  const flag = (mask: bigint) => {
    const set = (flags & mask) !== 0n
    flags &= ~mask

    return set
  }

  let etching: Etching | undefined

  if (flag(FLAG_ETCHING)) {
    const terms = flag(FLAG_TERMS)
      ? compact({
          amount: take(fields, TAG.amount, 1, single),
          cap: take(fields, TAG.cap, 1, single),
          heightEnd: take(fields, TAG.heightEnd, 1, upTo(U64_MAX)),
          heightStart: take(fields, TAG.heightStart, 1, upTo(U64_MAX)),
          offsetEnd: take(fields, TAG.offsetEnd, 1, upTo(U64_MAX)),
          offsetStart: take(fields, TAG.offsetStart, 1, upTo(U64_MAX)),
        })
      : undefined

    etching = {
      divisibility: take(fields, TAG.divisibility, 1, values => {
        const value = single(values)

        return value <= BigInt(MAX_DIVISIBILITY) ? Number(value) : undefined
      }),
      premine: take(fields, TAG.premine, 1, single),
      rune: take(fields, TAG.rune, 1, single),
      spacers: take(fields, TAG.spacers, 1, values => {
        const value = single(values)

        return value <= MAX_SPACERS ? Number(value) : undefined
      }),
      symbol: take(fields, TAG.symbol, 1, values => {
        const value = single(values)

        // `char::from_u32`: a Unicode scalar value, so no surrogates.
        return value <= 0x10ffffn && (value < 0xd800n || value > 0xdfffn)
          ? String.fromCodePoint(Number(value))
          : undefined
      }),
      terms,
      turbo: flag(FLAG_TURBO),
    }
  }

  const mint = take(fields, TAG.mint, 2, ([block = 0n, tx = 0n]) => runeId(block, tx))
  const pointer = take(fields, TAG.pointer, 1, values => {
    const value = single(values)

    return value <= U32_MAX && value < BigInt(scripts.length) ? Number(value) : undefined
  })

  if (etching !== undefined && supply(etching) === undefined) {
    flaw ??= 'supply-overflow'
  }

  if (flags !== 0n) {
    flaw ??= 'unrecognized-flag'
  }

  if ([...fields.keys()].some(tag => tag % 2n === 0n)) {
    flaw ??= 'unrecognized-even-tag'
  }

  if (flaw !== undefined) {
    return compact({etching: etching?.rune, flaw, kind: 'cenotaph' as const, mint, output})
  }

  return compact({edicts, etching: etching && compact(etching), kind: 'runestone' as const, mint, output, pointer})
}

const compact = <Value extends Record<string, unknown>>(value: Value): Value =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Value

/** `Etching::supply`: the premine and every mint, `undefined` when it overflows 128 bits. */
export const supply = (etching: Etching): bigint | undefined => {
  const total = (etching.premine ?? 0n) + (etching.terms?.cap ?? 0n) * (etching.terms?.amount ?? 0n)

  return total > U128_MAX ? undefined : total
}

/** A rune's name from its number, ord's modified base-26: 0 is `A`, 25 `Z`, 26 `AA`. */
export const runeName = (rune: bigint, spacers = 0): string => {
  let name = ''

  if (rune === U128_MAX) {
    name = 'BCGDENLQRQWDSLRUGSNLBTMFIJAV'
  } else {
    let n = rune + 1n

    while (n > 0n) {
      name = String.fromCharCode(65 + Number((n - 1n) % 26n)) + name
      n = (n - 1n) / 26n
    }
  }

  let spaced = ''

  for (const [index, character] of [...name].entries()) {
    spaced += character

    if (index < name.length - 1 && (spacers & (1 << index)) !== 0) {
      spaced += '•'
    }
  }

  return spaced
}

/** `840000:3`. */
export const formatRuneId = ({block, tx}: RuneId) => `${block}:${tx}`

/**
 * Where the runes a transaction's inputs hold go, as ord's indexer allocates them: by edict, then whatever is left to
 * the pointer, or to the first output that is not `OP_RETURN` (with or without a runestone). `burned` when they may
 * be burned without reaching an output: a cenotaph burns everything, and with no output that is not `OP_RETURN` the
 * rest is burned too. `outputs` are the outputs some of them may reach, `OP_RETURN` ones included (which burn what
 * they get). `ids` narrows the edicts to the runes of interest (every edict when `undefined`). Conservative: it knows
 * no amounts, so every output an edict of those runes names counts, and so does the default output.
 */
export const runeDestinations = (
  artifact: Artifact | undefined,
  scripts: readonly Uint8Array[],
  ids?: ReadonlySet<string>
): {readonly outputs: ReadonlySet<number>; readonly burned: boolean} => {
  if (artifact?.kind === 'cenotaph') {
    return {burned: true, outputs: new Set()}
  }

  const outputs = new Set<number>()
  const live = scripts.flatMap((script, index) => (isOpReturn(script) ? [] : [index]))

  for (const edict of artifact?.edicts ?? []) {
    // Block 0 is the rune etched by this transaction, which no input holds.
    if (edict.id.block !== 0n && (ids === undefined || ids.has(formatRuneId(edict.id)))) {
      // The number of outputs splits among every output that is not OP_RETURN.
      for (const output of edict.output === scripts.length ? live : [edict.output]) {
        outputs.add(output)
      }
    }
  }

  const fallback = artifact?.pointer ?? live[0]

  if (fallback !== undefined) {
    outputs.add(fallback)
  }

  return {burned: fallback === undefined, outputs}
}

/** Whether a script is OP_RETURN OP_13: a runestone's output, whether or not it is the first. Internal. */
export const isRunestoneScript = (script: Uint8Array) => script[0] === OP_RETURN && script[1] === MAGIC
