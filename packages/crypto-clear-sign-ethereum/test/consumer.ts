/**
 * What a consumer of @hzblj/crypto-clear-sign-ethereum writes. Type-checked against the packed tarballs by
 * scripts/pack-check.mjs, and against the source by this package's type check. Grow it with every export: real usage,
 * and an `@ts-expect-error` for each mistake the types must refuse (an unresolved declaration would make every import
 * `any`, and the negative cases are what notice).
 */
import {type ClearSigning, plainText, type Resolvers} from '@hzblj/crypto-clear-sign'
import {
  clearSignAuthorization,
  clearSignMessage,
  clearSignTransaction,
  clearSignTypedData,
  createDescriptorResolver,
  type Erc7730Descriptor,
  type Erc7730File,
  ETHEREUM_TEXTS,
  ETHEREUM_TOKENS,
  ETHEREUM_WARNINGS,
  type EthereumClearSignOptions,
  type EthereumDescriptorQuery,
  type EthereumWarningCode,
  mergeDescriptors,
  PERMIT2,
  VERSION,
} from '@hzblj/crypto-clear-sign-ethereum'
import {ETHEREUM_REGISTRY, REGISTRY_SOURCE, registryResolver} from '@hzblj/crypto-clear-sign-ethereum/registry'
import type {EthereumChain, Hex} from '@hzblj/crypto-ethereum'

const mine: Erc7730Descriptor = {
  context: {contract: {deployments: [{address: '0x0000000000000000000000000000000000000001', chainId: 1}]}},
  display: {
    formats: {'claim(uint256 amount)': {fields: [{format: 'raw', label: 'Amount', path: 'amount'}], intent: 'Claim'}},
  },
  metadata: {owner: 'Example'},
}

export const consume = async (chain: EthereumChain, unsigned: Hex, signer: string): Promise<ClearSigning[]> => {
  const files: Erc7730File[] = [...ETHEREUM_REGISTRY, {descriptor: mine, path: 'app/calldata-claim.json'}]
  const resolvers: Resolvers<EthereumDescriptorQuery, Erc7730Descriptor> = {
    clock: {now: () => Date.now()},
    descriptors: createDescriptorResolver(files),
    names: {name: () => ({name: 'Savings', relation: 'own'})},
    tokens: {token: async () => ({decimals: 6, symbol: 'USDC'})},
  }
  const options: EthereumClearSignOptions = {
    highFee: {above: 10n ** 17n, ratio: 0.5},
    nativeCurrency: {decimals: 18, symbol: 'ETH'},
    origin: 'app.example.com',
    resolvers,
    signer,
  }
  const transaction = await clearSignTransaction(chain, unsigned, options)
  const request = await clearSignTransaction(chain, {
    gas: 21_000n,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    nonce: 0,
    to: signer,
    value: 1n,
  })
  const typed = await clearSignTypedData(chain, {
    domain: {chainId: 1, name: 'Permit2', verifyingContract: PERMIT2},
    message: {spender: signer},
    primaryType: 'Approval',
    types: {Approval: [{name: 'spender', type: 'address'}]},
  })
  const message = await clearSignMessage(chain, 'Hello', {origin: 'example.com', signer})
  const authorization = await clearSignAuthorization(chain, {address: signer, nonce: 1n}, {signer})
  const code: EthereumWarningCode = ETHEREUM_WARNINGS.UNKNOWN_SPENDER.code
  const merged: Erc7730Descriptor = mergeDescriptors(mine, {metadata: {owner: 'Example Labs'}})
  const registry = registryResolver([{descriptor: merged, path: 'app/merged.json'}])

  // @ts-expect-error: a message is text or bytes
  await clearSignMessage(chain, 42)
  // @ts-expect-error: nativeCurrency has decimals
  await clearSignTransaction(chain, unsigned, {nativeCurrency: {symbol: 'POL'}})
  // @ts-expect-error: VERSION is a string
  const version: number = VERSION
  // @ts-expect-error: a code of another chain is not this package's
  const other: EthereumWarningCode = 'solana.OTHER_SIGNERS'

  return [
    transaction,
    request,
    typed,
    message,
    authorization,
    ...([plainText(transaction), code, ETHEREUM_TEXTS.label.gasLimit.code, ETHEREUM_TOKENS[0]?.symbol, version, other]
      .length > 0
      ? []
      : []),
    ...(REGISTRY_SOURCE.commit.length > 0 && registry.rejected.length === 0 ? [] : []),
  ]
}
