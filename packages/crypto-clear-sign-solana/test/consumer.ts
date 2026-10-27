/**
 * What a consumer of @hzblj/crypto-clear-sign-solana writes. Type-checked against the packed tarballs by
 * scripts/pack-check.mjs, and against the source by this package's type check. Grow it with every export: real usage,
 * and an `@ts-expect-error` for each mistake the types must refuse (an unresolved declaration would make every import
 * `any`, and the negative cases are what notice).
 */
import {type ClearSigning, localize, plainText, warningsAt} from '@hzblj/crypto-clear-sign'
import {
  clearSignMessage,
  clearSignTransaction,
  createIdlResolver,
  HIGH_PRIORITY_FEE,
  IDL_LIMITS,
  LAMPORTS_PER_SIGNATURE,
  type LookupTableResolver,
  SOLANA_CHAIN_IDS,
  SOLANA_PROGRAMS,
  SOLANA_TEXTS,
  SOLANA_TOKENS,
  SOLANA_WARNINGS,
  type SolanaClearSignChain,
  type SolanaClearSignOptions,
  type SolanaIdl,
  type SolanaResolvers,
  type SolanaTransactionPayload,
  type SolanaWarningCode,
  VERSION,
} from '@hzblj/crypto-clear-sign-solana'
import type {SolanaChain} from '@hzblj/crypto-solana'

const IDL: SolanaIdl = {
  address: '11111111111111111111111111111111',
  instructions: [
    {
      accounts: [
        {name: 'user', signer: true, writable: true},
        {accounts: [{name: 'inner'}], name: 'group'},
      ],
      args: [
        {name: 'amount', type: 'u64'},
        {name: 'route', type: {vec: {defined: {name: 'Step'}}}},
      ],
      discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
      name: 'swap',
    },
  ],
  metadata: {name: 'router', spec: '0.1.0', version: '0.1.0'},
  types: [{name: 'Step', type: {fields: [{name: 'percent', type: 'u8'}], kind: 'struct'}}],
}

export const consume = async (chain: SolanaChain, bytes: Uint8Array, sha256: (data: Uint8Array) => Uint8Array) => {
  const client: SolanaClearSignChain = chain
  const lookupTables: LookupTableResolver = {lookupTable: async ({address}) => (address === '' ? undefined : [])}
  const resolvers: SolanaResolvers = {
    descriptors: createIdlResolver([{idl: IDL, publisher: 'Router'}], {sha256}),
    lookupTables,
    tokens: {token: ({address}) => SOLANA_TOKENS[SOLANA_CHAIN_IDS['mainnet-beta']]?.[address]},
  }
  const options: SolanaClearSignOptions = {
    addressLookupTables: {},
    builtinTokens: true,
    highPriorityFee: HIGH_PRIORITY_FEE * 2n,
    origin: 'https://app.example',
    resolvers,
    signer: '11111111111111111111111111111111',
  }
  const payload: SolanaTransactionPayload = {message: bytes}
  const transaction: ClearSigning = await clearSignTransaction(client, bytes, options)
  const bare = await clearSignTransaction(chain, payload)
  const message = await clearSignMessage(chain, 'Hello', options)
  const offchain = await clearSignMessage(chain, bytes)
  const nonce: SolanaWarningCode = SOLANA_WARNINGS.DURABLE_NONCE.code
  const shared: SolanaWarningCode = 'UNLIMITED_APPROVAL'
  const label: 'solana.label.feePayer' = SOLANA_TEXTS.label.feePayer.code
  const intent: 'solana.intent.stake' = SOLANA_TEXTS.intent.stake.code
  const english = localize(transaction.intent, {[SOLANA_TEXTS.intent.stake.code]: 'Stakovat'})
  const fee: bigint = LAMPORTS_PER_SIGNATURE
  const depth: number = IDL_LIMITS.typeDepth
  const system: string | undefined = SOLANA_PROGRAMS['11111111111111111111111111111111']

  // @ts-expect-error: a transaction is its bytes, or {message} with the message's bytes, never Base64 text
  await clearSignTransaction(chain, 'AQAB')
  // @ts-expect-error: the priority fee threshold is lamports, a bigint
  await clearSignTransaction(chain, bytes, {highPriorityFee: 1000})
  // @ts-expect-error: a message is text or bytes
  await clearSignMessage(chain, {text: 'Hello'})
  // @ts-expect-error: a warning code is a shared one or Solana's own
  const foreign: SolanaWarningCode = 'ethereum.CONTRACT_CREATION'
  // @ts-expect-error: a lookup table resolver answers with the table's addresses
  const wrong: LookupTableResolver = {lookupTable: () => 'addresses'}
  // @ts-expect-error: VERSION is a string
  const version: number = VERSION

  return [
    bare.risk,
    message.intent,
    offchain.kind,
    nonce,
    shared,
    label,
    intent,
    english,
    fee,
    depth,
    system,
    foreign,
    wrong,
    version,
    plainText(transaction),
    warningsAt(transaction, [0]).length,
  ]
}
