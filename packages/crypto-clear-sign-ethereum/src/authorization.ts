import {
  type ActionInput,
  type ClearSigning,
  createClearSigning,
  INTENTS,
  LABELS,
  numberField,
  SUMMARIES,
  text,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {EthereumAuthorizationRequest} from '@hzblj/crypto-ethereum'

import {shown} from './calls/common'
import {ETHEREUM_TEXTS} from './catalogs'
import {createEnv, type Env, type EthereumClearSignChain, type EthereumClearSignOptions, lower, read} from './env'
import {ZERO_ADDRESS} from './known'

/** An authorization to describe: the delegate, its chain id (0 for every chain), its nonce, and who signed it. */
export type AuthorizationInput = {
  readonly address: string
  readonly chainId: number
  readonly nonce: bigint
  /** The account it delegates, when known: the signer for one about to be signed, the recovered one in a transaction. */
  readonly authority?: string
}

/**
 * An EIP-7702 authorization as an action. Delegating runs the delegate's code as the account, so it is
 * `ASSET_OWNERSHIP_TRANSFER`: critical for a delegate nothing names, high for one the `names` resolver knows (a
 * wallet's own smart account implementation). The zero address clears a delegation. Chain id 0 is `ALL_CHAINS`,
 * critical for a delegation. An authorization of another account than the signer (a sponsored one in a transaction)
 * puts nothing of the signer's at risk and carries neither. Internal.
 */
export const describeAuthorization = async (env: Env, input: AuthorizationInput): Promise<ActionInput> => {
  const delegate = await env.address({id: 'delegate', label: ETHEREUM_TEXTS.label.delegate, value: input.address})
  const clears = lower(input.address) === ZERO_ADDRESS
  const authority =
    input.authority === undefined
      ? []
      : [await env.address({id: 'authority', label: ETHEREUM_TEXTS.label.authority, value: input.authority})]
  const others = authority[0] !== undefined && env.options.signer !== undefined && authority[0].relation !== 'self'
  const known = delegate.relation === 'contract' || delegate.relation === 'own'
  const warnings: WarningInput[] = others
    ? []
    : [
        ...(input.chainId === 0
          ? [warning(WARNINGS.ALL_CHAINS, {fields: ['chainId'], ...(clears ? {} : {severity: 'critical'})})]
          : []),
        ...(clears
          ? []
          : [warning(WARNINGS.ASSET_OWNERSHIP_TRANSFER, {fields: ['delegate'], ...(known ? {severity: 'high'} : {})})]),
      ]

  return {
    fields: [
      ...authority,
      ...(clears ? [] : [delegate]),
      numberField({id: 'chainId', label: ETHEREUM_TEXTS.label.chain, value: input.chainId}),
      numberField({id: 'nonce', label: LABELS.nonce, secondary: true, value: input.nonce}),
    ],
    intent: clears ? ETHEREUM_TEXTS.intent.undelegate : INTENTS.delegate,
    source: {decoder: 'eip7702', kind: 'builtin'},
    summary: clears ? text(ETHEREUM_TEXTS.summary.undelegate) : text(SUMMARIES.delegate, {delegate: shown(delegate)}),
    warnings,
  }
}

/**
 * Describes an EIP-7702 authorization about to be signed on its own (to be carried by a type 4 transaction, perhaps
 * one someone else sends): the contract the account delegates to, named when the `names` resolver knows it, and the
 * chain it is valid on. Checked by the chain client first (`hashAuthorization`), so an authorization for another chain
 * is `CHAIN_MISMATCH`; chain id 0 is read here even without `allowAllChains`, and is `ALL_CHAINS`, critical.
 *
 * ```ts
 * const result = await clearSignAuthorization(crypto.chains.ethereum, {address: delegate, nonce: 7n}, {signer})
 * result.intent.code // 'intent.delegate'
 * result.warnings.map(warning => warning.code) // ['ASSET_OWNERSHIP_TRANSFER']
 * ```
 */
export const clearSignAuthorization = async (
  chain: EthereumClearSignChain,
  authorization: EthereumAuthorizationRequest,
  options: EthereumClearSignOptions = {}
): Promise<ClearSigning> => {
  const env = createEnv(chain, options)
  read(() => chain.hashAuthorization({...authorization, allowAllChains: true}), 'The authorization')
  const chainId = authorization.chainId === undefined ? env.chainId : Number(authorization.chainId)
  const action = await describeAuthorization(env, {
    address: authorization.address,
    chainId,
    nonce: BigInt(authorization.nonce),
    ...(options.signer === undefined ? {} : {authority: options.signer}),
  })

  return createClearSigning({
    ...action,
    chain: env.ref,
    kind: 'authorization',
    warnings: [...(action.warnings ?? []), ...env.warnings()],
  })
}
