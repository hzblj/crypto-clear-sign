import {
  type ActionInput,
  amountField,
  booleanField,
  durationField,
  type Field,
  INTENTS,
  LABELS,
  listField,
  numberField,
  rawField,
  SUMMARIES,
  text,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import {hex} from '@hzblj/nitro-crypto/adapter'

import {type AbiField, type AbiFunction, decodeParameters, parseFunction} from '../abi'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from '../catalogs'
import {type Env, lower} from '../env'
import {PERMIT2, WETH} from '../known'
import {
  addressOf,
  arg,
  batchOf,
  bytesOf,
  type Call,
  type DescribeCall,
  type Described,
  destinationWarnings,
  isUnlimited,
  required,
  shown,
  tokenAmount,
  uintOf,
  unreadable,
} from './common'
import {momentField} from './time'

/** What a built-in decoder is handed: the call, its decoded arguments, and a way to describe calls inside it. */
type Input = {
  readonly env: Env
  readonly call: Call
  readonly args: readonly AbiField[]
  readonly nested: DescribeCall
}

/** A function the package reads without a descriptor. Internal. */
export type Builtin = {
  /** The `source.decoder` name. */
  readonly decoder: string
  readonly fn: AbiFunction
  /** Whether the function takes ether. */
  readonly payable: boolean
  /** Whether it reads a call to this contract (WETH and Permit2 only theirs); every contract when absent. */
  readonly applies?: (env: Env, to: string) => boolean
  /** The action, or `undefined` when the arguments do not read as the function says (then nothing describes it). */
  readonly describe: (input: Input) => Promise<Described | undefined>
}

const spenderWarnings = (field: {readonly relation: string; readonly id?: string}): WarningInput[] =>
  field.relation === 'unknown' && field.id !== undefined
    ? [warning(ETHEREUM_WARNINGS.UNKNOWN_SPENDER, {fields: [field.id]})]
    : []

const erc20Approve = async (
  {args, call, env}: Input,
  mode: 'approve' | 'increase' | 'decrease',
  bits = 256
): Promise<Described> => {
  const spender = await env.address({id: 'spender', label: LABELS.spender, value: required(addressOf(arg(args, 0)))})
  const value = required(uintOf(arg(args, 1)))
  const unlimited = mode !== 'decrease' && isUnlimited(value, bits)
  const {field: amount, warnings: tokenWarnings} = await tokenAmount(
    env,
    {id: 'amount', label: LABELS.amount, token: call.to, value},
    {unlimited}
  )
  const token = await env.address({id: 'token', label: LABELS.token, value: call.to})
  const tokenName = amount.symbol ?? shown(token)
  const fields = [spender, amount, token]
  const base = {fields, payable: false, source: {decoder: 'erc20', kind: 'builtin'} as const}

  if (mode === 'decrease') {
    return {
      ...base,
      intent: ETHEREUM_TEXTS.intent.decreaseAllowance,
      summary: text(ETHEREUM_TEXTS.summary.decreaseAllowance, {amount: shown(amount), spender: shown(spender)}),
      warnings: tokenWarnings,
    }
  }

  if (mode === 'approve' && value === 0n) {
    return {
      ...base,
      intent: INTENTS.revoke,
      summary: text(SUMMARIES.revoke, {spender: shown(spender), token: tokenName}),
    }
  }

  return {
    ...base,
    intent: INTENTS.approve,
    summary: unlimited
      ? text(SUMMARIES.approveUnlimited, {spender: shown(spender), token: tokenName})
      : mode === 'increase'
        ? text(ETHEREUM_TEXTS.summary.increaseAllowance, {amount: shown(amount), spender: shown(spender)})
        : text(SUMMARIES.approve, {amount: shown(amount), spender: shown(spender)}),
    warnings: [
      ...(unlimited ? [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']})] : []),
      ...spenderWarnings(spender),
      ...tokenWarnings,
    ],
  }
}

const erc20Transfer = async ({args, call, env}: Input, withFrom: boolean): Promise<Described> => {
  const offset = withFrom ? 1 : 0
  const from = withFrom
    ? [await env.address({id: 'from', label: LABELS.from, value: required(addressOf(arg(args, 0)))})]
    : []
  const recipient = await env.address({
    id: 'recipient',
    label: LABELS.recipient,
    value: required(addressOf(arg(args, offset))),
  })
  const {field: amount, warnings} = await tokenAmount(env, {
    id: 'amount',
    label: LABELS.amount,
    token: call.to,
    value: required(uintOf(arg(args, offset + 1))),
  })
  const token = await env.address({id: 'token', label: LABELS.token, value: call.to})

  return {
    fields: [...from, recipient, amount, token],
    intent: INTENTS.send,
    payable: false,
    source: {decoder: 'erc20', kind: 'builtin'},
    summary: text(SUMMARIES.send, {amount: shown(amount), recipient: shown(recipient)}),
    warnings: [...destinationWarnings(recipient), ...warnings],
  }
}

const nftTransfer = async ({args, call, env}: Input, standard: 'erc721' | 'erc1155'): Promise<Described> => {
  const from = await env.address({id: 'from', label: LABELS.from, value: required(addressOf(arg(args, 0)))})
  const recipient = await env.address({
    id: 'recipient',
    label: LABELS.recipient,
    value: required(addressOf(arg(args, 1))),
  })
  const tokenId = required(uintOf(arg(args, 2)))
  const collection = await env.address({id: 'collection', label: ETHEREUM_TEXTS.label.collection, value: call.to})
  const count =
    standard === 'erc1155'
      ? [numberField({id: 'amount', label: LABELS.amount, value: required(uintOf(arg(args, 3)))})]
      : []
  const data = bytesOf(arg(args, standard === 'erc1155' ? 4 : 3))

  return {
    fields: [
      from,
      recipient,
      numberField({id: 'tokenId', label: ETHEREUM_TEXTS.label.tokenId, value: tokenId}),
      ...count,
      collection,
    ],
    intent: INTENTS.send,
    payable: false,
    raw: data === undefined || data.length === 0 ? [] : [rawField({id: 'data', label: LABELS.data, value: data})],
    source: {decoder: standard, kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.sendNft, {
      collection: shown(collection),
      recipient: shown(recipient),
      tokenId: tokenId.toString(),
    }),
    warnings: destinationWarnings(recipient),
  }
}

const nftBatchTransfer = async ({args, call, env}: Input): Promise<Described> => {
  const from = await env.address({id: 'from', label: LABELS.from, value: required(addressOf(arg(args, 0)))})
  const recipient = await env.address({
    id: 'recipient',
    label: LABELS.recipient,
    value: required(addressOf(arg(args, 1))),
  })
  const ids = arg(args, 2)
  const amounts = arg(args, 3)
  const collection = await env.address({id: 'collection', label: ETHEREUM_TEXTS.label.collection, value: call.to})

  if (ids?.kind !== 'array' || amounts?.kind !== 'array' || ids.items.length !== amounts.items.length) {
    return unreadable()
  }

  const items = ids.items.map((id, index) =>
    listField({
      id: `item-${index}`,
      items: [
        numberField({id: `tokenId-${index}`, label: ETHEREUM_TEXTS.label.tokenId, value: required(uintOf(id))}),
        numberField({id: `amount-${index}`, label: LABELS.amount, value: required(uintOf(amounts.items[index]))}),
      ],
      label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
    })
  )
  const data = bytesOf(arg(args, 4))

  return {
    fields: [from, recipient, ...items, collection],
    intent: INTENTS.send,
    payable: false,
    raw: data === undefined || data.length === 0 ? [] : [rawField({id: 'data', label: LABELS.data, value: data})],
    source: {decoder: 'erc1155', kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.sendNftBatch, {
      collection: shown(collection),
      count: items.length,
      recipient: shown(recipient),
    }),
    warnings: destinationWarnings(recipient),
  }
}

const setApprovalForAll = async ({args, call, env}: Input): Promise<Described> => {
  const operator = await env.address({id: 'operator', label: LABELS.operator, value: required(addressOf(arg(args, 0)))})
  const approvedArg = arg(args, 1)
  const approved = approvedArg?.kind === 'bool' ? approvedArg.value : unreadable()
  const collection = await env.address({id: 'collection', label: ETHEREUM_TEXTS.label.collection, value: call.to})
  const fields = [
    operator,
    booleanField({id: 'approved', label: ETHEREUM_TEXTS.label.approved, value: approved}),
    collection,
  ]
  const params = {collection: shown(collection), operator: shown(operator)}

  return approved
    ? {
        fields,
        intent: INTENTS.approve,
        payable: false,
        source: {decoder: 'nft', kind: 'builtin'},
        summary: text(ETHEREUM_TEXTS.summary.approveAll, params),
        warnings: [
          warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['operator', 'approved']}),
          ...spenderWarnings(operator),
        ],
      }
    : {
        fields,
        intent: INTENTS.revoke,
        payable: false,
        source: {decoder: 'nft', kind: 'builtin'},
        summary: text(ETHEREUM_TEXTS.summary.revokeAll, params),
      }
}

const wethDeposit = async ({call, env}: Input): Promise<Described> => {
  const amount = env.nativeAmount({id: 'amount', label: LABELS.amount, value: call.value})
  const token = await env.address({id: 'token', label: LABELS.token, value: call.to})

  return {
    fields: [amount, token],
    intent: ETHEREUM_TEXTS.intent.wrap,
    payable: true,
    showsValue: true,
    source: {decoder: 'weth', kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.wrap, {amount: shown(amount)}),
  }
}

const wethWithdraw = async ({args, call, env}: Input): Promise<Described> => {
  // Wrapped ether is ether 1:1, so its decimals are 18 whatever the token list says.
  const amount = amountField({
    decimals: 18,
    id: 'amount',
    label: LABELS.amount,
    symbol: 'WETH',
    token: env.checksum(call.to),
    value: required(uintOf(arg(args, 0))),
  })
  const token = await env.address({id: 'token', label: LABELS.token, value: call.to})

  return {
    fields: [amount, token],
    intent: ETHEREUM_TEXTS.intent.unwrap,
    payable: false,
    source: {decoder: 'weth', kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.unwrap, {amount: shown(amount)}),
  }
}

const permit2Approve = async ({args, env}: Input): Promise<Described> => {
  const tokenAddress = required(addressOf(arg(args, 0)))
  const token = await env.address({id: 'token', label: LABELS.token, value: tokenAddress})
  const spender = await env.address({id: 'spender', label: LABELS.spender, value: required(addressOf(arg(args, 1)))})
  const value = required(uintOf(arg(args, 2)))
  const unlimited = isUnlimited(value, 160)
  const {field: amount, warnings: tokenWarnings} = await tokenAmount(
    env,
    {id: 'amount', label: LABELS.amount, token: tokenAddress, value},
    {unlimited}
  )
  const expiration = required(uintOf(arg(args, 3)))
  // Permit2 reads an expiration of 0 as "now": the allowance lasts for the transaction that sets it.
  const moment =
    expiration === 0n
      ? {field: durationField({id: 'expiration', label: LABELS.validFor, value: 0}), warnings: []}
      : momentField(env, {id: 'expiration', label: LABELS.expiry, seconds: expiration})
  const tokenName = amount.symbol ?? shown(token)

  if (value === 0n) {
    return {
      fields: [token, spender, amount, moment.field],
      intent: INTENTS.revoke,
      payable: false,
      source: {decoder: 'permit2', kind: 'builtin'},
      summary: text(SUMMARIES.revoke, {spender: shown(spender), token: tokenName}),
    }
  }

  return {
    fields: [spender, amount, moment.field, token],
    intent: INTENTS.approve,
    payable: false,
    source: {decoder: 'permit2', kind: 'builtin'},
    summary: unlimited
      ? text(SUMMARIES.approveUnlimited, {spender: shown(spender), token: tokenName})
      : text(SUMMARIES.approve, {amount: shown(amount), spender: shown(spender)}),
    warnings: [
      ...(unlimited ? [warning(WARNINGS.UNLIMITED_APPROVAL, {fields: ['amount', 'spender']})] : []),
      ...spenderWarnings(spender),
      ...moment.warnings,
      ...tokenWarnings,
    ],
  }
}

const permit2Lockdown = async ({args, env}: Input): Promise<Described> => {
  const pairs = arg(args, 0)

  if (pairs?.kind !== 'array') {
    return unreadable()
  }

  const items = await Promise.all(
    pairs.items.map(async (pair, index) => {
      const fields = pair.kind === 'tuple' ? pair.fields : unreadable()

      return listField({
        id: `approval-${index}`,
        items: [
          await env.address({id: `token-${index}`, label: LABELS.token, value: required(addressOf(fields[0]?.value))}),
          await env.address({
            id: `spender-${index}`,
            label: LABELS.spender,
            value: required(addressOf(fields[1]?.value)),
          }),
        ],
        label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
      })
    })
  )

  return {
    fields: items,
    intent: INTENTS.revoke,
    payable: false,
    source: {decoder: 'permit2', kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.lockdown, {count: items.length}),
  }
}

/** The calls of a batch, each described one level deeper, as the root's actions. */
const batch = async (
  {call, env, nested}: Input,
  decoder: string,
  calls: readonly {
    readonly to: string
    readonly value: bigint
    readonly data: Uint8Array
    readonly delegate?: boolean
  }[],
  from: string | undefined,
  extra: {readonly fields?: readonly Field[]; readonly warnings?: readonly WarningInput[]} = {}
): Promise<Described> => {
  const actions = await Promise.all(
    calls.map(async inner => {
      const action = await nested({
        data: inner.data,
        depth: call.depth + 1,
        to: env.checksum(inner.to),
        value: inner.value,
        ...(from === undefined ? {} : {from}),
      })

      // A delegate call runs the target's code as the caller: everything the caller holds is the target's to use.
      return inner.delegate === true
        ? {...action, warnings: [...(action.warnings ?? []), warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER)]}
        : action
    })
  )
  const contract = await env.address({id: 'contract', label: LABELS.contract, value: call.to})

  return {
    ...batchOf(actions),
    actions,
    fields: [contract, ...(extra.fields ?? [])],
    payable: true,
    source: {decoder, kind: 'builtin'},
    ...(extra.warnings === undefined ? {} : {warnings: [...extra.warnings]}),
  }
}

const bytesItems = (value: AbiField['value'] | undefined): Uint8Array[] =>
  value?.kind === 'array' ? value.items.map(item => (item.kind === 'bytes' ? item.value : unreadable())) : unreadable()

const multicall = async (input: Input, prefix: 'none' | 'deadline' | 'blockhash'): Promise<Described> => {
  const {args, call, env} = input
  const data = bytesItems(arg(args, prefix === 'none' ? 0 : 1))
  const extra =
    prefix === 'deadline'
      ? (() => {
          // A transaction's deadline: it fails after it, and lasting long gives nothing away.
          const moment = momentField(env, {
            id: 'deadline',
            label: LABELS.deadline,
            longLived: false,
            seconds: required(uintOf(arg(args, 0))),
          })

          return {fields: [moment.field], warnings: moment.warnings}
        })()
      : prefix === 'blockhash'
        ? {
            fields: [
              rawField({
                id: 'blockhash',
                label: LABELS.data,
                secondary: true,
                value: required(bytesOf(arg(args, 0))),
              }),
            ],
          }
        : {}

  // multicall(bytes[]) delegate-calls the contract itself, one call after another: the caller stays the sender.
  return batch(
    input,
    'multicall',
    data.map(item => ({data: item, to: call.to, value: 0n})),
    call.from,
    extra
  )
}

/** Multicall3's and Multicall2's `(address target, [bool allowFailure,] [uint256 value,] bytes callData)[]`. */
const aggregate = async (input: Input, at: number, shape: 'plain' | 'allowFailure' | 'value'): Promise<Described> => {
  const list = arg(input.args, at)

  if (list?.kind !== 'array') {
    return unreadable()
  }

  const calls = list.items.map(item => {
    const fields = item.kind === 'tuple' ? item.fields : unreadable()
    const last = fields[fields.length - 1]?.value

    return {
      data: required(bytesOf(last)),
      to: required(addressOf(fields[0]?.value)),
      value: shape === 'value' ? required(uintOf(fields[2]?.value)) : 0n,
    }
  })

  // The calls are Multicall3's own: the targets see it, not the signer, as their caller.
  return batch(input, 'multicall', calls, input.call.to)
}

/** Safe's MultiSend: `operation (1) || to (20) || value (32) || length (32) || data`, packed, one after another. */
const multiSend = async (input: Input): Promise<Described> => {
  const packed = required(bytesOf(arg(input.args, 0)))
  const calls: {to: string; value: bigint; data: Uint8Array; delegate: boolean}[] = []
  let at = 0

  while (at < packed.length) {
    if (at + 85 > packed.length || calls.length >= 256) {
      return unreadable()
    }

    const operation = packed[at] ?? 0
    const length = BigInt(`0x${hex.encode(packed.subarray(at + 53, at + 85))}`)

    if (operation > 1 || length > BigInt(packed.length - at - 85)) {
      return unreadable()
    }

    calls.push({
      data: packed.slice(at + 85, at + 85 + Number(length)),
      delegate: operation === 1,
      to: `0x${hex.encode(packed.subarray(at + 1, at + 21))}`,
      value: BigInt(`0x${hex.encode(packed.subarray(at + 21, at + 53))}`),
    })
    at += 85 + Number(length)
  }

  return batch(input, 'safe-multisend', calls, undefined)
}

const CALLS = parseFunction('f((address target,uint256 value,bytes data)[] calls)').inputs

const callList = (value: AbiField['value'] | undefined) =>
  value?.kind === 'array'
    ? value.items.map(item => {
        const fields = item.kind === 'tuple' ? item.fields : unreadable()

        return {
          data: required(bytesOf(fields[2]?.value)),
          to: required(addressOf(fields[0]?.value)),
          value: required(uintOf(fields[1]?.value)),
        }
      })
    : unreadable()

/** The account that makes a smart account's calls: the signer itself when it calls its own (EIP-7702) code. */
const accountOf = ({call, env}: Input) => (env.context.isSigner(call.to) ? env.options.signer : call.to)

/**
 * ERC-7821's and ERC-7579's `execute(bytes32 mode, bytes executionData)`: the first byte of `mode` is the call type,
 * 0x00 one call (`target || value || data`, packed), 0x01 a batch (`(address,uint256,bytes)[]`, ABI-encoded), 0xff a
 * delegate call (`target || data`).
 */
const execute7821 = async (input: Input): Promise<Described | undefined> => {
  const mode = required(bytesOf(arg(input.args, 0)))
  const data = required(bytesOf(arg(input.args, 1)))
  const from = accountOf(input)

  switch (mode[0]) {
    case 0x00:
      return data.length < 52
        ? unreadable()
        : batch(
            input,
            'smart-account',
            [
              {
                data: data.slice(52),
                to: `0x${hex.encode(data.subarray(0, 20))}`,
                value: BigInt(`0x${hex.encode(data.subarray(20, 52))}`),
              },
            ],
            from
          )
    case 0x01:
      return batch(input, 'smart-account', callList(decodeParameters(CALLS, data)[0]?.value), from)
    case 0xff:
      return data.length < 20
        ? unreadable()
        : batch(
            input,
            'smart-account',
            [{data: data.slice(20), delegate: true, to: `0x${hex.encode(data.subarray(0, 20))}`, value: 0n}],
            from
          )
    default:
      return undefined
  }
}

const transferOwnership = async ({args, call, env}: Input): Promise<Described> => {
  const contract = await env.address({id: 'contract', label: LABELS.contract, value: call.to})
  const owner = await env.address({
    id: 'newOwner',
    label: ETHEREUM_TEXTS.label.newOwner,
    value: required(addressOf(arg(args, 0))),
  })

  return {
    fields: [contract, owner],
    intent: INTENTS.transferOwnership,
    payable: false,
    source: {decoder: 'ownable', kind: 'builtin'},
    summary: text(SUMMARIES.transferOwnership, {asset: shown(contract), recipient: shown(owner)}),
    warnings: [warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['newOwner', 'contract']})],
  }
}

const upgrade = async ({args, call, env, nested}: Input): Promise<Described> => {
  const contract = await env.address({id: 'contract', label: LABELS.contract, value: call.to})
  const implementation = await env.address({
    id: 'implementation',
    label: ETHEREUM_TEXTS.label.implementation,
    value: required(addressOf(arg(args, 0))),
  })
  const data = bytesOf(arg(args, 1))
  // upgradeToAndCall runs `data` on the new code, as the proxy.
  const actions: ActionInput[] =
    data === undefined || data.length === 0
      ? []
      : [
          await nested({
            data,
            depth: call.depth + 1,
            to: call.to,
            value: 0n,
            ...(call.from === undefined ? {} : {from: call.from}),
          }),
        ]

  return {
    actions,
    fields: [contract, implementation],
    intent: ETHEREUM_TEXTS.intent.upgrade,
    payable: data !== undefined,
    source: {decoder: 'proxy', kind: 'builtin'},
    summary: text(ETHEREUM_TEXTS.summary.upgrade, {contract: shown(contract), implementation: shown(implementation)}),
    warnings: [warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['implementation', 'contract']})],
  }
}

const isAt = (address: string) => (_env: Env, to: string) => lower(to) === lower(address)

const define = (
  signature: string,
  decoder: string,
  describe: Builtin['describe'],
  options: {readonly payable?: boolean; readonly applies?: Builtin['applies']} = {}
): Builtin => ({
  decoder,
  describe,
  fn: parseFunction(signature),
  payable: options.payable ?? false,
  ...(options.applies === undefined ? {} : {applies: options.applies}),
})

/**
 * The functions the package reads by itself, whatever the contract (WETH and Permit2 only at their addresses): what
 * the README's "What it recognizes" lists. A built-in wins over a descriptor for the same call, so a descriptor can
 * never relabel an approval.
 */
export const BUILTINS: readonly Builtin[] = [
  define('transfer(address to,uint256 amount)', 'erc20', input => erc20Transfer(input, false)),
  define('transferFrom(address from,address to,uint256 amount)', 'erc20', input => erc20Transfer(input, true)),
  define('approve(address spender,uint256 amount)', 'erc20', input => erc20Approve(input, 'approve')),
  define('increaseAllowance(address spender,uint256 addedValue)', 'erc20', input => erc20Approve(input, 'increase')),
  define('decreaseAllowance(address spender,uint256 subtractedValue)', 'erc20', input =>
    erc20Approve(input, 'decrease')
  ),
  define('setApprovalForAll(address operator,bool approved)', 'nft', setApprovalForAll),
  define('safeTransferFrom(address from,address to,uint256 tokenId)', 'erc721', input => nftTransfer(input, 'erc721')),
  define('safeTransferFrom(address from,address to,uint256 tokenId,bytes data)', 'erc721', input =>
    nftTransfer(input, 'erc721')
  ),
  define('safeTransferFrom(address from,address to,uint256 id,uint256 amount,bytes data)', 'erc1155', input =>
    nftTransfer(input, 'erc1155')
  ),
  define(
    'safeBatchTransferFrom(address from,address to,uint256[] ids,uint256[] amounts,bytes data)',
    'erc1155',
    nftBatchTransfer
  ),
  define('deposit()', 'weth', wethDeposit, {
    applies: (env, to) => WETH[env.chainId] !== undefined && lower(WETH[env.chainId] ?? '') === lower(to),
    payable: true,
  }),
  define('withdraw(uint256 amount)', 'weth', wethWithdraw, {
    applies: (env, to) => WETH[env.chainId] !== undefined && lower(WETH[env.chainId] ?? '') === lower(to),
  }),
  define('approve(address token,address spender,uint160 amount,uint48 expiration)', 'permit2', permit2Approve, {
    applies: isAt(PERMIT2),
  }),
  define('lockdown((address token,address spender)[] approvals)', 'permit2', permit2Lockdown, {applies: isAt(PERMIT2)}),
  define('multicall(bytes[] data)', 'multicall', input => multicall(input, 'none'), {payable: true}),
  define('multicall(uint256 deadline,bytes[] data)', 'multicall', input => multicall(input, 'deadline'), {
    payable: true,
  }),
  define('multicall(bytes32 previousBlockhash,bytes[] data)', 'multicall', input => multicall(input, 'blockhash'), {
    payable: true,
  }),
  define('aggregate((address target,bytes callData)[] calls)', 'multicall', input => aggregate(input, 0, 'plain'), {
    payable: true,
  }),
  define(
    'tryAggregate(bool requireSuccess,(address target,bytes callData)[] calls)',
    'multicall',
    input => aggregate(input, 1, 'plain'),
    {payable: true}
  ),
  define(
    'blockAndAggregate((address target,bytes callData)[] calls)',
    'multicall',
    input => aggregate(input, 0, 'plain'),
    {payable: true}
  ),
  define(
    'tryBlockAndAggregate(bool requireSuccess,(address target,bytes callData)[] calls)',
    'multicall',
    input => aggregate(input, 1, 'plain'),
    {payable: true}
  ),
  define(
    'aggregate3((address target,bool allowFailure,bytes callData)[] calls)',
    'multicall',
    input => aggregate(input, 0, 'allowFailure'),
    {payable: true}
  ),
  define(
    'aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls)',
    'multicall',
    input => aggregate(input, 0, 'value'),
    {payable: true}
  ),
  define('multiSend(bytes transactions)', 'safe-multisend', multiSend, {payable: true}),
  define('execute(bytes32 mode,bytes executionData)', 'smart-account', execute7821, {payable: true}),
  define(
    'executeBatch((address target,uint256 value,bytes data)[] calls)',
    'smart-account',
    input => batch(input, 'smart-account', callList(arg(input.args, 0)), accountOf(input)),
    {payable: true}
  ),
  define(
    'execute(address target,uint256 value,bytes data)',
    'smart-account',
    input =>
      batch(
        input,
        'smart-account',
        [
          {
            data: required(bytesOf(arg(input.args, 2))),
            to: required(addressOf(arg(input.args, 0))),
            value: required(uintOf(arg(input.args, 1))),
          },
        ],
        accountOf(input)
      ),
    {payable: true}
  ),
  define('transferOwnership(address newOwner)', 'ownable', transferOwnership),
  define('changeAdmin(address newAdmin)', 'proxy', transferOwnership),
  define('renounceOwnership()', 'ownable', async ({call, env}) => {
    const contract = await env.address({id: 'contract', label: LABELS.contract, value: call.to})

    return {
      fields: [contract],
      intent: ETHEREUM_TEXTS.intent.renounceOwnership,
      payable: false,
      source: {decoder: 'ownable', kind: 'builtin'},
      summary: text(ETHEREUM_TEXTS.summary.renounceOwnership, {contract: shown(contract)}),
      warnings: [warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['contract']})],
    }
  }),
  define('upgradeTo(address newImplementation)', 'proxy', upgrade),
  define('upgradeToAndCall(address newImplementation,bytes data)', 'proxy', upgrade, {payable: true}),
]

const BY_SELECTOR = new Map<string, Builtin[]>()

for (const builtin of BUILTINS) {
  BY_SELECTOR.set(builtin.fn.selector, [...(BY_SELECTOR.get(builtin.fn.selector) ?? []), builtin])
}

/** The built-ins that read `selector` at `to`, most specific (address-bound) first. Internal. */
export const builtinsFor = (env: Env, selector: string, to: string): Builtin[] =>
  (BY_SELECTOR.get(selector) ?? [])
    .filter(builtin => builtin.applies === undefined || builtin.applies(env, to))
    .sort((a, b) => Number(b.applies !== undefined) - Number(a.applies !== undefined))
