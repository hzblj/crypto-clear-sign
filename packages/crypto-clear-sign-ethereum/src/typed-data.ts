import {
  type ActionInput,
  amountField,
  type ClearSigning,
  createClearSigning,
  type DisplayText,
  durationField,
  externalText,
  type Field,
  hasHiddenCharacters,
  INTENTS,
  LABELS,
  listField,
  maxUint,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {TypedDataDefinition, TypedDataField} from '@hzblj/crypto-ethereum'
import {hex, utf8} from '@hzblj/nitro-crypto/adapter'

import type {AbiField, AbiValue} from './abi'
import {elementaryType} from './abi'
import {addressOf, isUnlimited, shown, tokenAmount, uintOf} from './calls/common'
import {momentField} from './calls/time'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from './catalogs'
import {encodeType, normalizeEncodeType} from './eip712'
import {createEnv, type Env, type EthereumClearSignChain, type EthereumClearSignOptions, lower, read} from './env'
import {describeTypedDataByDescriptor, type TypedDataSubject} from './erc7730/apply'
import {genericField} from './erc7730/render'
import {PERMIT2} from './known'

type Types = {readonly [struct: string]: readonly TypedDataField[]}

const ARRAY = /^(.+)\[([0-9]*)\]$/

const toInteger = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    return BigInt(value)
  }

  return BigInt(String(value).trim())
}

const toBytes = (value: unknown): Uint8Array =>
  value instanceof Uint8Array ? value.slice() : hex.decode(String(value))

/**
 * A typed data value as the decoded tree the rest reads, by its EIP-712 type. The chain client has hashed it already,
 * so every value is known to be well formed; only declared members are read, as only they are signed.
 */
const toValue = (type: string, value: unknown, types: Types, depth: number): AbiValue => {
  if (depth > 64) {
    throw new RangeError('Typed data nests too deep.')
  }

  const array = ARRAY.exec(type)

  if (array) {
    return {
      items: (value as readonly unknown[]).map(item => toValue(array[1] ?? '', item, types, depth + 1)),
      kind: 'array',
    }
  }

  const members = types[type]

  if (members !== undefined) {
    const record = value as Readonly<Record<string, unknown>>

    return {
      fields: members.map(member => ({
        name: member.name,
        value: toValue(member.type, record[member.name], types, depth + 1),
      })),
      kind: 'tuple',
    }
  }

  const kind = elementaryType(type)

  switch (kind?.kind) {
    case 'address':
      return {kind: 'address', value: String(value).toLowerCase()}
    case 'bool':
      return {kind: 'bool', value: value === true}
    case 'string': {
      const words = String(value)

      return {bytes: utf8.encode(words), kind: 'string', value: words}
    }
    case 'bytes':
      return kind.size === undefined
        ? {kind: 'bytes', value: toBytes(value)}
        : {kind: 'bytes', size: kind.size, value: toBytes(value)}
    case 'uint':
    case 'int':
      return {bits: kind.bits, kind: kind.kind, value: toInteger(value)}
    default:
      throw new RangeError('A typed data type is neither a struct nor an EIP-712 type.')
  }
}

const member = (fields: readonly AbiField[], name: string): AbiValue | undefined =>
  fields.find(field => field.name === name)?.value

const tupleOf = (value: AbiValue | undefined): readonly AbiField[] => (value?.kind === 'tuple' ? value.fields : [])

/** The parts of typed data the built-ins read. */
type Message = {
  readonly env: Env
  readonly fields: readonly AbiField[]
  readonly verifyingContract?: string
}

const spenderWarnings = (field: {readonly relation: string; readonly id?: string}): WarningInput[] =>
  field.relation === 'unknown' && field.id !== undefined
    ? [warning(ETHEREUM_WARNINGS.UNKNOWN_SPENDER, {fields: [field.id]})]
    : []

const approval = async (
  message: Message,
  input: {
    readonly decoder: string
    readonly owner?: AbiValue
    readonly ownerLabel: DisplayText
    readonly spender: AbiValue | undefined
    readonly value: bigint
    readonly bits: number
    readonly token?: string
    readonly deadline: {
      readonly id: string
      readonly label: DisplayText
      readonly seconds: bigint
      readonly zeroIsNever?: boolean
    }
    readonly nonce?: bigint
    readonly forceUnlimited?: boolean
  }
): Promise<ActionInput> => {
  const {env} = message
  const owner = addressOf(input.owner)
  const spenderAddress = addressOf(input.spender)

  if (spenderAddress === undefined) {
    throw new RangeError('A permit names its spender.')
  }

  const spender = await env.address({id: 'spender', label: LABELS.spender, value: spenderAddress})
  const unlimited = input.forceUnlimited === true || isUnlimited(input.value, input.bits)
  const amount =
    input.token === undefined
      ? {
          field: amountField({id: 'amount', label: LABELS.amount, unlimited, value: input.value}),
          warnings: [warning(WARNINGS.UNKNOWN_TOKEN, {fields: ['amount']})],
        }
      : await tokenAmount(
          env,
          {id: 'amount', label: LABELS.amount, token: input.token, value: input.value},
          {unlimited}
        )
  const deadline = momentField(env, input.deadline)
  const fields: Field[] = [
    ...(owner === undefined ? [] : [await env.address({id: 'owner', label: input.ownerLabel, value: owner})]),
    spender,
    amount.field,
    deadline.field,
    ...(input.nonce === undefined
      ? []
      : [numberField({id: 'nonce', label: LABELS.nonce, secondary: true, value: input.nonce})]),
  ]
  const tokenName = amount.field.symbol ?? input.token ?? '?'

  if (input.value === 0n && input.forceUnlimited !== true) {
    return {
      fields,
      intent: INTENTS.revoke,
      source: {decoder: input.decoder, kind: 'builtin'},
      summary: text(SUMMARIES.revoke, {spender: shown(spender), token: tokenName}),
    }
  }

  return {
    fields,
    intent: INTENTS.approve,
    source: {decoder: input.decoder, kind: 'builtin'},
    summary: unlimited
      ? text(SUMMARIES.approveUnlimited, {spender: shown(spender), token: tokenName})
      : text(SUMMARIES.approve, {amount: shown(amount.field), spender: shown(spender)}),
    warnings: [
      ...(unlimited ? [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']})] : []),
      ...spenderWarnings(spender),
      ...deadline.warnings,
      ...amount.warnings,
    ],
  }
}

/** EIP-2612's `Permit`: an ERC-20 approval by signature; the token is the verifying contract. */
const eip2612 = (message: Message) => {
  const {fields} = message

  return approval(message, {
    bits: 256,
    deadline: {id: 'deadline', label: LABELS.deadline, seconds: uintOf(member(fields, 'deadline')) ?? 0n},
    decoder: 'eip2612',
    nonce: uintOf(member(fields, 'nonce')),
    owner: member(fields, 'owner'),
    ownerLabel: LABELS.owner,
    spender: member(fields, 'spender'),
    value: uintOf(member(fields, 'value')) ?? 0n,
    ...(message.verifyingContract === undefined ? {} : {token: message.verifyingContract}),
  })
}

/** DAI's permit: all or nothing (`allowed`), and an expiry of 0 never ends. */
const daiPermit = (message: Message) => {
  const {fields} = message
  const allowed = member(fields, 'allowed')
  const all = allowed?.kind === 'bool' && allowed.value

  return approval(message, {
    bits: 256,
    deadline: {
      id: 'deadline',
      label: LABELS.expiry,
      seconds: uintOf(member(fields, 'expiry')) ?? 0n,
      zeroIsNever: true,
    },
    decoder: 'dai-permit',
    forceUnlimited: all,
    nonce: uintOf(member(fields, 'nonce')),
    owner: member(fields, 'holder'),
    ownerLabel: LABELS.owner,
    spender: member(fields, 'spender'),
    value: all ? maxUint(256) : 0n,
    ...(message.verifyingContract === undefined ? {} : {token: message.verifyingContract}),
  })
}

/** Permit2's `expiration`: 0 is "for this transaction only", anything else a moment. */
const permit2Expiration = (env: Env, id: string, seconds: bigint) =>
  seconds === 0n
    ? {field: durationField({id, label: LABELS.validFor, value: 0}), warnings: [] as WarningInput[]}
    : momentField(env, {id, label: LABELS.expiry, seconds})

/** Permit2's allowance permits (`PermitSingle`, `PermitBatch`): amounts at 160 bits, an expiry each, a deadline. */
const permit2Allowance = async (message: Message, batch: boolean): Promise<ActionInput> => {
  const {env, fields} = message
  const details = batch
    ? (() => {
        const list = member(fields, 'details')

        return list?.kind === 'array' ? list.items : []
      })()
    : [member(fields, 'details')]
  const spenderAddress = addressOf(member(fields, 'spender'))

  if (spenderAddress === undefined || details.some(detail => detail === undefined)) {
    throw new RangeError('A Permit2 permit names its spender and details.')
  }

  const spender = await env.address({id: 'spender', label: LABELS.spender, value: spenderAddress})
  const warnings: WarningInput[] = [...spenderWarnings(spender)]
  const items: Field[] = []
  const unlimitedIds: string[] = []
  let single: {amount: Field; token: string} | undefined

  for (const [index, detail] of details.entries()) {
    const parts = tupleOf(detail)
    const suffix = batch ? `-${index}` : ''
    const token = addressOf(member(parts, 'token')) ?? ''
    const value = uintOf(member(parts, 'amount')) ?? 0n
    const unlimited = isUnlimited(value, 160)
    const amount = await tokenAmount(env, {id: `amount${suffix}`, label: LABELS.amount, token, value}, {unlimited})
    const expiration = permit2Expiration(env, `expiration${suffix}`, uintOf(member(parts, 'expiration')) ?? 0n)
    const entry = [
      await env.address({id: `token${suffix}`, label: LABELS.token, value: token}),
      amount.field,
      expiration.field,
    ]
    warnings.push(...amount.warnings, ...expiration.warnings)

    if (unlimited) {
      unlimitedIds.push(`amount${suffix}`)
    }

    if (batch) {
      items.push(
        listField({id: `permit${suffix}`, items: entry, label: text(ETHEREUM_TEXTS.label.item, {index: index + 1})})
      )
    } else {
      items.push(...entry)
      single = {amount: amount.field, token: amount.field.kind === 'amount' ? (amount.field.symbol ?? token) : token}
    }
  }

  const deadline = momentField(env, {
    id: 'sigDeadline',
    label: ETHEREUM_TEXTS.label.signatureDeadline,
    seconds: uintOf(member(fields, 'sigDeadline')) ?? 0n,
  })
  warnings.push(...deadline.warnings)

  if (unlimitedIds.length > 0) {
    warnings.unshift(warning(WARNINGS.UNLIMITED_APPROVAL, {fields: [...unlimitedIds, 'spender']}))
  }

  return {
    fields: [spender, ...items, deadline.field],
    intent: INTENTS.approve,
    source: {decoder: 'permit2', kind: 'builtin'},
    summary:
      single === undefined
        ? text(ETHEREUM_TEXTS.summary.permitBatch, {count: details.length, spender: shown(spender)})
        : unlimitedIds.length > 0
          ? text(SUMMARIES.approveUnlimited, {spender: shown(spender), token: single.token})
          : text(SUMMARIES.approve, {amount: shown(single.amount), spender: shown(spender)}),
    warnings,
  }
}

/** Permit2's signature transfers (`PermitTransferFrom`, batch, witness): one transfer each, up to a deadline. */
const permit2Transfer = async (message: Message, batch: boolean, witness: boolean): Promise<ActionInput> => {
  const {env, fields} = message
  const permitted = member(fields, 'permitted')
  const list = batch ? (permitted?.kind === 'array' ? permitted.items : []) : [permitted]
  const spenderAddress = addressOf(member(fields, 'spender'))

  if (spenderAddress === undefined || list.some(entry => entry === undefined)) {
    throw new RangeError('A Permit2 transfer names its spender and tokens.')
  }

  const spender = await env.address({id: 'spender', label: LABELS.spender, value: spenderAddress})
  const warnings: WarningInput[] = [...spenderWarnings(spender)]
  const items: Field[] = []
  const unlimitedIds: string[] = []

  for (const [index, entry] of list.entries()) {
    const parts = tupleOf(entry)
    const suffix = batch ? `-${index}` : ''
    const token = addressOf(member(parts, 'token')) ?? ''
    const value = uintOf(member(parts, 'amount')) ?? 0n
    const unlimited = isUnlimited(value, 256)
    const amount = await tokenAmount(env, {id: `amount${suffix}`, label: LABELS.amount, token, value}, {unlimited})
    warnings.push(...amount.warnings)

    if (unlimited) {
      unlimitedIds.push(`amount${suffix}`)
    }

    items.push(
      batch
        ? listField({
            id: `permit${suffix}`,
            items: [await env.address({id: `token${suffix}`, label: LABELS.token, value: token}), amount.field],
            label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
          })
        : amount.field
    )
  }

  const deadline = momentField(env, {
    id: 'deadline',
    label: LABELS.deadline,
    seconds: uintOf(member(fields, 'deadline')) ?? 0n,
  })
  const witnessValue = witness ? member(fields, 'witness') : undefined
  const witnessField =
    witnessValue === undefined
      ? []
      : [
          await genericField(
            env,
            {id: 'witness', label: ETHEREUM_TEXTS.label.witness, value: witnessValue},
            (id, words) => {
              if (hasHiddenCharacters(words)) {
                warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
              }
            }
          ),
        ]
  warnings.push(...deadline.warnings)

  if (unlimitedIds.length > 0) {
    warnings.unshift(warning(WARNINGS.UNLIMITED_APPROVAL, {fields: [...unlimitedIds, 'spender']}))
  }

  const [first] = items

  return {
    fields: [
      spender,
      ...items,
      deadline.field,
      numberField({id: 'nonce', label: LABELS.nonce, secondary: true, value: uintOf(member(fields, 'nonce')) ?? 0n}),
      ...witnessField,
    ],
    intent: INTENTS.approve,
    source: {decoder: 'permit2', kind: 'builtin'},
    summary:
      batch || first === undefined
        ? text(ETHEREUM_TEXTS.summary.permitBatch, {count: items.length, spender: shown(spender)})
        : text(ETHEREUM_TEXTS.summary.permitTransfer, {amount: shown(first), spender: shown(spender)}),
    warnings,
  }
}

const TOKEN_PERMISSIONS = 'TokenPermissions(address token,uint256 amount)'
const PERMIT_DETAILS = 'PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'

/** Built-in readers by `encodeType`; Permit2's only for Permit2's own domain. */
const TYPED_BUILTINS: Readonly<
  Record<string, {readonly permit2?: boolean; readonly read: (message: Message) => Promise<ActionInput>}>
> = {
  'Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)': {read: daiPermit},
  'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)': {read: eip2612},
  [`PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)${PERMIT_DETAILS}`]: {
    permit2: true,
    read: message => permit2Allowance(message, true),
  },
  [`PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)${TOKEN_PERMISSIONS}`]:
    {permit2: true, read: message => permit2Transfer(message, true, false)},
  [`PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)${PERMIT_DETAILS}`]: {
    permit2: true,
    read: message => permit2Allowance(message, false),
  },
  [`PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)${TOKEN_PERMISSIONS}`]:
    {
      permit2: true,
      read: message => permit2Transfer(message, false, false),
    },
}

/** Permit2's witness transfers: the standard members first, then a `witness` of the dApp's own type. */
const witnessReader = (primaryType: string, types: Types): ((message: Message) => Promise<ActionInput>) | undefined => {
  const members = (types[primaryType] ?? []).map(({name, type}) => `${type} ${name}`)
  const batch = primaryType === 'PermitBatchWitnessTransferFrom'
  const expected = [
    `TokenPermissions${batch ? '[]' : ''} permitted`,
    'address spender',
    'uint256 nonce',
    'uint256 deadline',
  ]
  const permissions = (types.TokenPermissions ?? []).map(({name, type}) => `${type} ${name}`).join(',')

  return (primaryType === 'PermitWitnessTransferFrom' || batch) &&
    members.length === 5 &&
    expected.every((entry, index) => members[index] === entry) &&
    (types[primaryType]?.[4]?.name ?? '') === 'witness' &&
    permissions === 'address token,uint256 amount'
    ? message => permit2Transfer(message, batch, true)
    : undefined
}

/** Every member, as it is: the fallback for typed data nothing reads. */
const generic = async (env: Env, message: AbiValue, primaryType: string, domainName: string): Promise<ActionInput> => {
  const warnings: WarningInput[] = [warning(WARNINGS.BLIND_SIGNING)]
  const fields: Field[] = []

  for (const field of tupleOf(message)) {
    const name = field.name ?? 'value'
    fields.push(
      await genericField(
        env,
        {id: `message.${name}`.slice(0, 128), label: externalText(name), value: field.value},
        (id, words) => {
          if (hasHiddenCharacters(words)) {
            warnings.push(warning(WARNINGS.HIDDEN_CHARACTERS, {fields: [id]}))
          }
        }
      )
    )
  }

  return {
    fields,
    intent: ETHEREUM_TEXTS.intent.signTypedData,
    source: {kind: 'unknown'},
    summary: text(ETHEREUM_TEXTS.summary.signTypedData, {domain: domainName, primaryType}),
    warnings,
  }
}

const domainValues = (env: Env, typedData: TypedDataDefinition) => {
  const domain = (typedData.domain ?? {}) as Readonly<Record<string, unknown>>
  const chainId = domain.chainId === undefined ? undefined : Number(toInteger(domain.chainId))
  const verifyingContract =
    typeof domain.verifyingContract === 'string' ? env.checksum(domain.verifyingContract) : undefined

  return {
    chainId,
    domain,
    name: typeof domain.name === 'string' ? domain.name : undefined,
    salt: domain.salt === undefined ? undefined : toBytes(domain.salt),
    verifyingContract,
    version: typeof domain.version === 'string' ? domain.version : undefined,
  }
}

/**
 * Describes EIP-712 typed data (viem's `TypedDataDefinition`, an `eth_signTypedData_v4` request's JSON parsed),
 * hashed with `chain.hashTypedData` first, so typed data the adapter refuses is refused here (`INVALID_INPUT`) and a
 * domain for another chain is `CHAIN_MISMATCH`.
 *
 * Built-in: EIP-2612 `Permit`, DAI's permit, and Permit2's `PermitSingle`, `PermitBatch`, `PermitTransferFrom`,
 * `PermitBatchTransferFrom` and their witness variants (on Permit2's own domain). Then an ERC-7730 descriptor bound to
 * the domain and type. Anything else shows every member with `BLIND_SIGNING`. A domain without a chain id is
 * `ALL_CHAINS`; the domain's name, version and verifying contract are fields of the root.
 *
 * ```ts
 * const result = await clearSignTypedData(crypto.chains.ethereum, permit, {signer})
 * result.summary?.text // 'Allow 0x… to spend an unlimited amount of USDC'
 * ```
 */
export const clearSignTypedData = async (
  chain: EthereumClearSignChain,
  typedData: TypedDataDefinition,
  options: EthereumClearSignOptions = {}
): Promise<ClearSigning> => {
  const env = createEnv(chain, options)
  read(() => chain.hashTypedData(typedData), 'The typed data')
  const types = typedData.types as Types
  const {chainId, domain, name, salt, verifyingContract, version} = domainValues(env, typedData)
  const primaryType = typedData.primaryType
  const message =
    primaryType === 'EIP712Domain'
      ? ({fields: [], kind: 'tuple'} as const)
      : toValue(primaryType, typedData.message, types, 0)
  const signature = normalizeEncodeType(encodeType(types, primaryType))
  const permit2 = verifyingContract !== undefined && lower(verifyingContract) === lower(PERMIT2)
  const builtin = TYPED_BUILTINS[signature]
  const reader =
    builtin !== undefined && (builtin.permit2 !== true || permit2)
      ? builtin.read
      : permit2
        ? witnessReader(primaryType, types)
        : undefined
  const subject: Message = {
    env,
    fields: tupleOf(message),
    ...(verifyingContract === undefined ? {} : {verifyingContract}),
  }
  const extra: WarningInput[] = []
  let described: ActionInput | undefined

  if (reader !== undefined) {
    try {
      described = await reader(subject)
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error
      }
    }
  }

  if (described === undefined && primaryType !== 'EIP712Domain') {
    const query = {
      chain: env.ref,
      encodeType: signature,
      kind: 'eip712' as const,
      primaryType,
      ...(chainId === undefined ? {} : {chainId}),
      ...(verifyingContract === undefined ? {} : {verifyingContract}),
      ...(name === undefined ? {} : {domainName: name}),
    }
    const answer = await env.context.descriptor(query)

    if (answer !== undefined) {
      let separator: string | undefined

      try {
        separator = `0x${hex.encode(chain.hashDomain({domain: typedData.domain ?? {}, types: typedData.types}))}`
      } catch {
        separator = undefined
      }

      const target: TypedDataSubject = {
        domain,
        encodeType: signature,
        primaryType,
        ...(chainId === undefined ? {} : {chainId}),
        ...(verifyingContract === undefined ? {} : {verifyingContract}),
        ...(separator === undefined ? {} : {domainSeparator: separator}),
      }
      const applied = await describeTypedDataByDescriptor(env, target, message, answer)
      described = applied.described
      extra.push(...applied.warnings)
    }
  }

  const action = described ?? (await generic(env, message, primaryType, name ?? verifyingContract ?? '?'))
  const taken = new Set((action.fields ?? []).map(field => field.id))
  const domainFields: Field[] = [
    ...(name === undefined ? [] : [textField({id: 'domain', label: LABELS.domain, value: name})]),
    ...(verifyingContract === undefined || taken.has('contract')
      ? []
      : [await env.address({id: 'contract', label: LABELS.contract, value: verifyingContract})]),
    ...(version === undefined
      ? []
      : [textField({id: 'version', label: ETHEREUM_TEXTS.label.version, secondary: true, value: version})]),
    ...(salt === undefined
      ? []
      : [rawField({id: 'salt', label: ETHEREUM_TEXTS.label.salt, secondary: true, value: salt})]),
  ]
  const domainWarnings: WarningInput[] = [
    ...(chainId === undefined ? [warning(WARNINGS.ALL_CHAINS)] : []),
    ...(name !== undefined && hasHiddenCharacters(name)
      ? [warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['domain']})]
      : []),
    ...(version !== undefined && hasHiddenCharacters(version)
      ? [warning(WARNINGS.HIDDEN_CHARACTERS, {fields: ['version']})]
      : []),
  ]

  return createClearSigning({
    ...action,
    chain: env.ref,
    fields: [...(action.fields ?? []), ...domainFields],
    kind: 'typed-data',
    warnings: [...(action.warnings ?? []), ...extra, ...domainWarnings, ...env.warnings()],
  })
}
