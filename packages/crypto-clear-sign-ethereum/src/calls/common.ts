import {
  type ActionInput,
  type AddressField,
  type AmountField,
  type Field,
  formatField,
  INTENTS,
  LABELS,
  maxUint,
  rawField,
  SUMMARIES,
  text,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'

import type {AbiField, AbiValue} from '../abi'
import type {Env} from '../env'

/** A call to describe: a transaction's, or one inside a multicall, a batch or a descriptor's `calldata` field. */
export type Call = {
  /** The contract called, EIP-55. */
  readonly to: string
  /** Wei sent with it. */
  readonly value: bigint
  readonly data: Uint8Array
  /** Who makes the call, when known: the signer for a transaction, a batching contract for the calls it makes. */
  readonly from?: string
  /** 0 for a transaction's own call, one more for each level of nesting. */
  readonly depth: number
}

/** Describes a call nested in another (a multicall's, a batch's): the same pipeline, one level deeper. */
export type DescribeCall = (call: Call) => Promise<ActionInput>

/** A decode a decoder cannot finish: the pipeline moves on (to descriptors, then to the raw call). Internal. */
export class Unreadable extends Error {
  constructor() {
    super('The arguments do not read as the function says.')
    this.name = 'Unreadable'
  }
}

/** Throws `Unreadable`. Internal. */
export const unreadable = (): never => {
  throw new Unreadable()
}

/** `value`, or `Unreadable` when it is missing. Internal. */
export const required = <Value>(value: Value | undefined): Value => (value === undefined ? unreadable() : value)

/** How deep calls are described inside calls; deeper ones are shown raw. */
export const MAX_CALL_DEPTH = 4

/** What a described call says beside its action: whether it takes ether, as far as its decoder knows. */
export type Described = ActionInput & {
  /** `false` when the decoder knows the function takes no ether; `true` when it does; absent when unknown. */
  readonly payable?: boolean
  /** Whether the action already shows the call's value. */
  readonly showsValue?: boolean
}

/**
 * Whether an approval of `value` at a protocol's width is unlimited: the upper half of the range (where `maxUint`
 * and "max minus what was spent" land), or, at 256 bits, exactly `maxUint(96)` or `maxUint(128)` (tokens that keep
 * allowances in narrower integers). Internal.
 */
export const isUnlimited = (value: bigint, bits: number): boolean =>
  value >= 1n << BigInt(bits - 1) || (bits === 256 && (value === maxUint(96) || value === maxUint(128)))

/** An address or amount as the English of a summary shows it: a name, a formatted amount. Internal. */
export const shown = (field: AddressField | AmountField | Field): string =>
  field.kind === 'address' ? (field.name ?? field.value) : formatField(field)

/** A token amount, with `UNKNOWN_TOKEN` when the token list does not have the token. Internal. */
export const tokenAmount = async (
  env: Env,
  input: {readonly id: string; readonly label: AmountField['label']; readonly token: string; readonly value: bigint},
  options: {readonly unlimited?: boolean; readonly chainId?: number; readonly secondary?: boolean} = {}
): Promise<{readonly field: AmountField; readonly warnings: WarningInput[]}> => {
  const field = await env.contextFor(options.chainId ?? env.chainId).amount({
    id: input.id,
    label: input.label,
    token: env.checksum(input.token),
    unlimited: options.unlimited ?? false,
    value: input.value,
    ...(options.secondary === true ? {secondary: true} : {}),
  })

  return {
    field,
    warnings: field.decimals === undefined ? [warning(WARNINGS.UNKNOWN_TOKEN, {fields: [input.id]})] : [],
  }
}

/** `UNKNOWN_DESTINATION` when assets go to an address nothing knows. Internal. */
export const destinationWarnings = (field: AddressField): WarningInput[] =>
  field.relation === 'unknown' && field.id !== undefined
    ? [warning(WARNINGS.UNKNOWN_DESTINATION, {fields: [field.id]})]
    : []

/** A uint argument, or `undefined`. Internal. */
export const uintOf = (value: AbiValue | undefined): bigint | undefined =>
  value?.kind === 'uint' ? value.value : undefined

/** An address argument (lowercase), or `undefined`. Internal. */
export const addressOf = (value: AbiValue | undefined): string | undefined =>
  value?.kind === 'address' ? value.value : undefined

/** Bytes, or `undefined`. Internal. */
export const bytesOf = (value: AbiValue | undefined): Uint8Array | undefined =>
  value?.kind === 'bytes' ? value.value : undefined

/** The argument at `index`. Internal. */
export const arg = (args: readonly AbiField[], index: number): AbiValue | undefined => args[index]?.value

/**
 * The intent and summary of several actions signed at once: the one action's when there is one; the one that is not
 * an approval when the rest are its approvals (approve, then swap, is a swap); a batch otherwise. Internal.
 */
export const batchOf = (actions: readonly ActionInput[]): Pick<ActionInput, 'intent' | 'summary'> => {
  const [first] = actions

  if (actions.length === 1 && first !== undefined) {
    return {intent: first.intent, ...(first.summary === undefined ? {} : {summary: first.summary})}
  }

  const others = actions.filter(action => action.intent.code !== INTENTS.approve.code)
  const [main] = others

  if (others.length === 1 && main !== undefined && actions.length > 1) {
    return {intent: main.intent, ...(main.summary === undefined ? {} : {summary: main.summary})}
  }

  return {intent: INTENTS.batch, summary: text(SUMMARIES.batch, {count: actions.length})}
}

/**
 * A call nothing reads: the contract, the value, and the call data raw, with `UNKNOWN_CONTRACT_CALL`. Internal.
 */
export const unknownCall = async (env: Env, call: Call, extra: readonly WarningInput[] = []): Promise<Described> => {
  const contract = await env.address({id: 'contract', label: LABELS.contract, value: call.to})
  const fields: Field[] = [contract]

  if (call.value > 0n) {
    fields.push(env.nativeAmount({id: 'value', label: LABELS.amount, value: call.value}))
  }

  return {
    fields,
    intent: INTENTS.contractCall,
    raw: [rawField({id: 'data', label: LABELS.data, value: call.data})],
    showsValue: true,
    source: {kind: 'unknown'},
    summary: text(SUMMARIES.contractCall, {contract: shown(contract)}),
    warnings: [warning(WARNINGS.UNKNOWN_CONTRACT_CALL, {fields: ['contract']}), ...extra],
  }
}

/** Ether to an address, with no call data. Internal. */
export const nativeTransfer = async (env: Env, call: Call): Promise<Described> => {
  const recipient = await env.address({id: 'recipient', label: LABELS.recipient, value: call.to})
  const amount = env.nativeAmount({id: 'amount', label: LABELS.amount, value: call.value})

  return {
    fields: [recipient, amount],
    intent: INTENTS.send,
    payable: true,
    showsValue: true,
    source: {decoder: 'native-transfer', kind: 'builtin'},
    summary: text(SUMMARIES.send, {amount: shown(amount), recipient: shown(recipient)}),
    warnings: destinationWarnings(recipient),
  }
}
