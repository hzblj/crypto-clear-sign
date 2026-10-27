import {
  type ActionInput,
  type ClearSigning,
  createClearSigning,
  type Field,
  INTENTS,
  LABELS,
  listField,
  numberField,
  rawField,
  SUMMARIES,
  text,
  textField,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {EthereumTransactionRequest, Hex, ParsedEthereumTransaction} from '@hzblj/crypto-ethereum'
import {hex} from '@hzblj/nitro-crypto/adapter'

import {describeAuthorization} from './authorization'
import {batchOf, type Described} from './calls/common'
import {describeCall} from './calls/describe'
import {ETHEREUM_TEXTS, ETHEREUM_WARNINGS} from './catalogs'
import {createEnv, type Env, type EthereumClearSignChain, type EthereumClearSignOptions, read} from './env'

const TYPE_NAMES: Readonly<Record<ParsedEthereumTransaction['type'], string>> = {
  eip1559: 'EIP-1559',
  eip2930: 'EIP-2930',
  eip7702: 'EIP-7702',
  legacy: 'Legacy',
}

/** An action without what only the pipeline reads. */
const action = ({payable: _payable, showsValue: _shows, ...rest}: Described): ActionInput => rest

/** The most a transaction can cost, in wei: its gas limit at its gas price, or at its max fee per gas. */
const maxFeeOf = (transaction: ParsedEthereumTransaction): bigint =>
  transaction.type === 'legacy' || transaction.type === 'eip2930'
    ? transaction.gas * transaction.gasPrice
    : transaction.gas * transaction.maxFeePerGas

const feeFields = (env: Env, transaction: ParsedEthereumTransaction): Field[] => {
  const fees: Field[] =
    transaction.type === 'legacy' || transaction.type === 'eip2930'
      ? [
          env.nativeAmount({
            id: 'gasPrice',
            label: ETHEREUM_TEXTS.label.gasPrice,
            secondary: true,
            value: transaction.gasPrice,
          }),
        ]
      : [
          env.nativeAmount({
            id: 'maxFeePerGas',
            label: ETHEREUM_TEXTS.label.maxFeePerGas,
            secondary: true,
            value: transaction.maxFeePerGas,
          }),
          env.nativeAmount({
            id: 'maxPriorityFeePerGas',
            label: ETHEREUM_TEXTS.label.maxPriorityFeePerGas,
            secondary: true,
            value: transaction.maxPriorityFeePerGas,
          }),
        ]
  const accessList = transaction.type === 'legacy' ? [] : transaction.accessList

  return [
    env.nativeAmount({id: 'maxFee', label: LABELS.maxFee, value: maxFeeOf(transaction)}),
    numberField({
      id: 'gasLimit',
      label: ETHEREUM_TEXTS.label.gasLimit,
      secondary: true,
      unit: ETHEREUM_TEXTS.unit.gas,
      value: transaction.gas,
    }),
    ...fees,
    numberField({id: 'nonce', label: LABELS.nonce, secondary: true, value: transaction.nonce}),
    textField({
      id: 'transactionType',
      label: ETHEREUM_TEXTS.label.transactionType,
      secondary: true,
      value: TYPE_NAMES[transaction.type],
    }),
    ...(accessList.length === 0
      ? []
      : [
          listField({
            id: 'accessList',
            items: accessList.map((entry, index) =>
              textField({
                id: `access-${index}`,
                label: text(ETHEREUM_TEXTS.label.item, {index: index + 1}),
                value: `${entry.address} (${entry.storageKeys.length})`,
              })
            ),
            label: ETHEREUM_TEXTS.label.accessList,
            secondary: true,
          }),
        ]),
  ]
}

/** `HIGH_FEE` when the most the transaction can cost is out of proportion, as `highFee` says. */
const feeWarnings = (env: Env, transaction: ParsedEthereumTransaction): WarningInput[] => {
  const fee = maxFeeOf(transaction)
  const ratio = env.options.highFee?.ratio ?? 1
  const above = env.options.highFee?.above
  const scale = 1_000_000n
  const relative =
    transaction.value > 0n && fee * scale > transaction.value * BigInt(Math.max(1, Math.round(ratio * 1_000_000)))
  const absolute = above !== undefined && fee > above

  return relative || absolute ? [warning(WARNINGS.HIGH_FEE, {fields: ['maxFee']})] : []
}

const contractCreation = (env: Env, transaction: ParsedEthereumTransaction): ActionInput => ({
  fields:
    transaction.value > 0n
      ? [env.nativeAmount({id: 'value', label: ETHEREUM_TEXTS.label.value, value: transaction.value})]
      : [],
  intent: INTENTS.deploy,
  raw: [rawField({id: 'data', label: LABELS.data, value: transaction.data})],
  source: {decoder: 'contract-creation', kind: 'builtin'},
  summary: text(SUMMARIES.deploy),
  warnings: [warning(ETHEREUM_WARNINGS.CONTRACT_CREATION, {fields: transaction.value > 0n ? ['value'] : []})],
})

/**
 * Describes an unsigned transaction of any type the adapter reads (legacy with EIP-155, EIP-2930, EIP-1559,
 * EIP-7702): its bytes (`Hex` or `Uint8Array`, read with `chain.parseTransaction`), or a request (serialized with
 * `chain.serializeTransaction` and read back the same way, so what is described is exactly what is signed). A
 * transaction for another chain id is `CHAIN_MISMATCH`, one the adapter refuses `INVALID_INPUT`, a blob transaction
 * `UNSUPPORTED`.
 *
 * The call is read by a built-in decoder (transfers, ERC-20, NFTs, WETH, Permit2, multicalls and batches, ownership),
 * else by an ERC-7730 descriptor from `resolvers.descriptors`, else shown raw with `UNKNOWN_CONTRACT_CALL`. The fee
 * (`maxFee`, with gas fields behind "More details") is `HIGH_FEE` past `highFee`; a contract creation is
 * `ethereum.CONTRACT_CREATION`; an EIP-7702 transaction's authorizations are actions of their own, before its call.
 *
 * ```ts
 * const result = await clearSignTransaction(crypto.chains.ethereum, unsigned, {signer: account.address})
 * result.intent.code // 'intent.approve'
 * result.warnings.map(warning => warning.code) // ['UNLIMITED_APPROVAL', 'ethereum.UNKNOWN_SPENDER']
 * ```
 */
export const clearSignTransaction = async (
  chain: EthereumClearSignChain,
  transaction: Hex | Uint8Array | EthereumTransactionRequest,
  options: EthereumClearSignOptions = {}
): Promise<ClearSigning> => {
  const env = createEnv(chain, options)
  const parsed = read(
    () =>
      chain.parseTransaction(
        typeof transaction === 'string' || transaction instanceof Uint8Array
          ? transaction
          : chain.serializeTransaction(transaction)
      ),
    'The transaction'
  )
  const data = hex.decode(parsed.data)
  const main: ActionInput | undefined =
    parsed.to === null
      ? contractCreation(env, parsed)
      : parsed.type === 'eip7702' && data.length === 0 && parsed.value === 0n
        ? undefined
        : action(
            await describeCall(env, {
              data,
              depth: 0,
              to: parsed.to,
              value: parsed.value,
              ...(options.signer === undefined ? {} : {from: options.signer}),
            })
          )
  const authorizations =
    parsed.type === 'eip7702'
      ? await Promise.all(
          parsed.authorizationList.map(authorization => {
            let authority: string | undefined

            try {
              authority = chain.recoverAuthorizationAddress(authorization)
            } catch {
              authority = undefined
            }

            return describeAuthorization(env, {
              address: authorization.address,
              chainId: authorization.chainId,
              nonce: authorization.nonce,
              ...(authority === undefined ? {} : {authority}),
            })
          })
        )
      : []
  const fees = feeFields(env, parsed)
  const warnings = [...feeWarnings(env, parsed), ...env.warnings()]

  if (authorizations.length > 0) {
    const actions = main === undefined ? authorizations : [...authorizations, main]

    return createClearSigning({
      ...batchOf(authorizations),
      actions,
      chain: env.ref,
      fields: fees,
      kind: 'transaction',
      source: {decoder: 'eip7702', kind: 'builtin'},
      warnings,
    })
  }

  const root: ActionInput = main ?? {intent: INTENTS.unknown, source: {kind: 'unknown'}}

  return createClearSigning({
    ...root,
    chain: env.ref,
    fields: [...(root.fields ?? []), ...fees],
    kind: 'transaction',
    warnings: [...(root.warnings ?? []), ...warnings],
  })
}
