import type {
  AttestationOptions,
  ChainClient,
  GitHubSource,
  RegistryIndex,
  TrustedTokens,
} from '@ethereum-sourcify/clear-signing'
import {
  type AddressField,
  type AmountField,
  amountField,
  type ChainRef,
  ClearSignError,
  type ClearSignOptions,
  createResolverContext,
  type DisplayText,
  hasHiddenCharacters,
  type NameInfo,
  RESOLVER_NAMES,
  type ResolverContext,
  type Resolvers,
  type TokenInfo,
  WARNINGS,
  type WarningInput,
  warning,
} from '@hzblj/crypto-clear-sign'
import type {EthereumChain} from '@hzblj/crypto-ethereum'
import {isCryptoError} from '@hzblj/nitro-crypto/adapter'

import type {Erc7730Descriptor} from './erc7730/types'
import {CHAIN_NAMES, ETHEREUM_TOKENS, KNOWN_CONTRACTS, WETH} from './known'

/**
 * What the package asks the `descriptors` resolver: a call (`calldata`: the chain, the contract called and the
 * selector) or typed data (`eip712`: the chain, the domain's verifying contract and chain id when it has them, the
 * primary type and its EIP-712 `encodeType`). Answer with a descriptor whose `context` binds to it: the package checks
 * the binding itself and ignores a descriptor that does not bind (`ethereum.INVALID_DESCRIPTOR`).
 */
export type EthereumDescriptorQuery =
  | {
      readonly kind: 'calldata'
      readonly chain: ChainRef
      readonly chainId: number
      /** EIP-55. */
      readonly address: string
      /** `0x` and 8 lowercase hex digits. */
      readonly selector: string
    }
  | {
      readonly kind: 'eip712'
      readonly chain: ChainRef
      /** The domain's chain id, when it has one. */
      readonly chainId?: number
      /** The domain's verifying contract, EIP-55, when it has one. */
      readonly verifyingContract?: string
      readonly primaryType: string
      /** `Mail(Person from,Person to,string contents)Person(string name,address wallet)`. */
      readonly encodeType: string
      readonly domainName?: string
    }

/**
 * ERC-7730 online, off unless given: the Ethereum clear signing registry on GitHub, a trusted token list, and the
 * attestation policy, passed to `@ethereum-sourcify/clear-signing` as they are. Asked only for what the `descriptors`
 * resolver has nothing for, and only when a call or a message is described: nothing is fetched before.
 */
export type SourcifyOptions = {
  /**
   * The registry on GitHub (`ethereum/clear-signing-erc7730-registry` unless `githubSource` says otherwise). Fetch its
   * index once, `await fetchPrebuiltRegistryIndex()`, and pass it: without one, every lookup fetches it again.
   */
  readonly registry?: {readonly index?: RegistryIndex; readonly githubSource?: Partial<GitHubSource>}
  /**
   * Tokens the wallet trusts, by chain id and address (`erc20`, `erc721`): their calls no built-in decoder reads are
   * read by the reference implementation's templates. Never gated by `attestations`.
   */
  readonly trustedTokens?: TrustedTokens
  /**
   * ERC-8176: a registry descriptor is used only when an auditor in `trustedAttesters` attests it (checked offline,
   * revocation through `chainClient`); otherwise `ethereum.UNTRUSTED_DESCRIPTOR`. Needs `chainClient`.
   */
  readonly attestations?: AttestationOptions
  /** `eth_call` on Ethereum mainnet, for the attestations' revocation check. */
  readonly chainClient?: ChainClient
}

/** The chain's native asset: ETH with 18 decimals unless told. */
export type NativeCurrency = {readonly symbol: string; readonly decimals: number}

/**
 * The options of every `clearSign*` function: the core's (`signer`, `resolvers` with ERC-7730 descriptors) and what
 * Ethereum needs.
 */
export type EthereumClearSignOptions = ClearSignOptions<EthereumDescriptorQuery, Erc7730Descriptor> & {
  /** The native asset's symbol and decimals: the adapter's network has a name and a chain id, not a symbol. */
  readonly nativeCurrency?: NativeCurrency
  /**
   * When a fee is `HIGH_FEE`: when the most the transaction can cost is more than `ratio` times the ether it sends
   * (default 1, only when it sends some), or more than `above` wei in any case (default: no absolute limit).
   */
  readonly highFee?: {readonly ratio?: number; readonly above?: bigint}
  /**
   * The host of the site asking for the signature (`app.uniswap.org`), as the wallet knows it from its connection:
   * a sign-in request for another domain is `ethereum.SIGN_IN_DOMAIN_MISMATCH`. Never take it from the payload.
   */
  readonly origin?: string
  /**
   * Whether the built-in token list (`ETHEREUM_TOKENS`) and contract names back the app's resolvers. Default `true`;
   * the app's answers always come first.
   */
  readonly builtins?: boolean
  /** ERC-7730 online (the registry on GitHub, trusted tokens, attestations): off unless given. */
  readonly sourcify?: SourcifyOptions
}

/** The members of the chain client the package calls: `crypto.chains.ethereum` has them all. */
export type EthereumClearSignChain = Pick<
  EthereumChain<string>,
  | 'network'
  | 'checksumAddress'
  | 'parseTransaction'
  | 'serializeTransaction'
  | 'hashTypedData'
  | 'hashDomain'
  | 'hashAuthorization'
  | 'recoverAuthorizationAddress'
>

/** How addresses compare: EIP-55 is case only. Internal. */
export const lower = (address: string) => address.toLowerCase()

/** `eip155:<chainId>`, with the adapter's network name (or a known one, for another chain). Internal. */
export const chainRef = (chainId: number, name?: string): ChainRef => ({
  family: 'ethereum',
  id: `eip155:${chainId}`,
  name: name ?? CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
})

/**
 * Runs an adapter call, its refusals as `ClearSignError`s: `CHAIN_MISMATCH` and `UNSUPPORTED` as such, anything else
 * the adapter refuses as `INVALID_INPUT`, the adapter's error the `cause`. Messages name what failed, never the
 * payload. Internal.
 */
export const read = <Value>(run: () => Value, what: string): Value => {
  try {
    return run()
  } catch (error) {
    if (isCryptoError(error, 'CHAIN_MISMATCH')) {
      throw new ClearSignError('CHAIN_MISMATCH', `${what} is for another chain than the client's.`, {cause: error})
    }

    if (isCryptoError(error, 'UNSUPPORTED')) {
      throw new ClearSignError('UNSUPPORTED', `${what} is of a kind the adapter does not read.`, {cause: error})
    }

    if (isCryptoError(error)) {
      throw new ClearSignError('INVALID_INPUT', `${what} could not be read.`, {cause: error})
    }

    throw error
  }
}

const invalidOption = (message: string) => new ClearSignError('INVALID_ARGUMENT', message)

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const checkSourcify = (sourcify: SourcifyOptions | undefined) => {
  if (sourcify === undefined) {
    return
  }

  const {attestations, chainClient, registry, trustedTokens} = isObject(sourcify) ? sourcify : ({} as SourcifyOptions)
  const index = registry?.index

  if (
    !isObject(sourcify) ||
    (registry !== undefined &&
      (!isObject(registry) ||
        (index !== undefined &&
          (!isObject(index) || !isObject(index.calldataIndex) || !isObject(index.typedDataIndex))))) ||
    (trustedTokens !== undefined && !isObject(trustedTokens))
  ) {
    throw invalidOption(
      'sourcify is {registry?: {index?, githubSource?}, trustedTokens?, attestations?, chainClient?}.'
    )
  }

  if (
    attestations !== undefined &&
    (!isObject(attestations) ||
      !Array.isArray(attestations.trustedAttesters) ||
      !attestations.trustedAttesters.every(entry => typeof entry === 'string' && /^0x[0-9a-fA-F]{40}$/.test(entry)))
  ) {
    throw invalidOption('sourcify.attestations.trustedAttesters is a list of addresses.')
  }

  if (
    (attestations !== undefined || chainClient !== undefined) &&
    (!isObject(chainClient) || typeof chainClient.call !== 'function')
  ) {
    throw invalidOption('sourcify.attestations needs sourcify.chainClient, an object with call(chainId, {to, data}).')
  }
}

const checkOptions = (options: EthereumClearSignOptions): {native: NativeCurrency} => {
  if (typeof options !== 'object' || options === null) {
    throw invalidOption('The options are an object.')
  }

  const native = options.nativeCurrency ?? {decimals: 18, symbol: 'ETH'}

  if (
    typeof native.symbol !== 'string' ||
    native.symbol.length === 0 ||
    native.symbol.length > 32 ||
    hasHiddenCharacters(native.symbol) ||
    !Number.isInteger(native.decimals) ||
    native.decimals < 0 ||
    native.decimals > 255
  ) {
    throw invalidOption('nativeCurrency is a symbol of 1 to 32 visible characters and decimals from 0 to 255.')
  }

  const {highFee} = options

  if (
    highFee !== undefined &&
    ((highFee.ratio !== undefined &&
      (typeof highFee.ratio !== 'number' || !Number.isFinite(highFee.ratio) || highFee.ratio <= 0)) ||
      (highFee.above !== undefined && (typeof highFee.above !== 'bigint' || highFee.above < 0n)))
  ) {
    throw invalidOption('highFee.ratio is a positive number and highFee.above a bigint of wei, 0 or more.')
  }

  if (
    options.signer !== undefined &&
    (typeof options.signer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(options.signer))
  ) {
    throw invalidOption('signer is a 20-byte hex address.')
  }

  if (options.origin !== undefined && (typeof options.origin !== 'string' || options.origin.length > 253)) {
    throw invalidOption('origin is a host name.')
  }

  checkSourcify(options.sourcify)

  return {native: {decimals: native.decimals, symbol: native.symbol}}
}

const chainIdOf = (chain: ChainRef) => Number(chain.id.slice('eip155:'.length))

const builtinToken = (chain: ChainRef, address: string): TokenInfo | undefined => {
  const chainId = chainIdOf(chain)
  const token = ETHEREUM_TOKENS.find(entry => entry.chainId === chainId && lower(entry.address) === lower(address))

  return token === undefined ? undefined : {decimals: token.decimals, name: token.name, symbol: token.symbol}
}

const builtinName = (chain: ChainRef, address: string): NameInfo | undefined => {
  const known = KNOWN_CONTRACTS[lower(address)]
  const weth = WETH[chainIdOf(chain)]

  if (known !== undefined) {
    return {name: known, relation: 'contract'}
  }

  return weth !== undefined && lower(weth) === lower(address)
    ? {name: 'Wrapped Ether', relation: 'contract'}
    : undefined
}

/** Everything one `clearSign*` call reads through. Internal. */
export type Env = {
  readonly chain: EthereumClearSignChain
  readonly chainId: number
  readonly ref: ChainRef
  readonly options: EthereumClearSignOptions
  readonly native: NativeCurrency
  readonly context: ResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>
  /** The context for tokens and names on another chain (a cross-chain descriptor's `chainId`). */
  readonly contextFor: (chainId: number) => ResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>
  /** EIP-55, by the chain client. */
  readonly checksum: (address: string) => string
  /** An address field: the signer, a name the resolvers or the package know, a token, or unknown. */
  readonly address: (input: {
    readonly id?: string
    readonly label: DisplayText
    readonly value: string
    readonly secondary?: boolean
    /** A name from a descriptor bound to the call, used when no resolver names the address. */
    readonly fallbackName?: string
    readonly chainId?: number
  }) => Promise<AddressField>
  /** A native amount field (ETH unless `nativeCurrency` says otherwise). */
  readonly nativeAmount: (input: {
    readonly id?: string
    readonly label: DisplayText
    readonly value: bigint
    readonly secondary?: boolean
    readonly unlimited?: boolean
  }) => AmountField
  /** `RESOLVER_FAILED` once, naming every resolver that failed on any chain; nothing when none did. */
  readonly warnings: () => readonly WarningInput[]
}

/** The environment of one call: options checked, resolvers wrapped with the built-ins, failures merged. Internal. */
export const createEnv = (chain: EthereumClearSignChain, options: EthereumClearSignOptions = {}): Env => {
  const {native} = checkOptions(options)
  const chainId = chain.network.chainId
  const ref = chainRef(chainId, chain.network.name)
  const app: Resolvers<EthereumDescriptorQuery, Erc7730Descriptor> = options.resolvers ?? {}
  const builtins = options.builtins !== false

  // The app's token list and names alone, through the core's checks: an answer that throws or makes no sense is no
  // answer, so the built-ins answer instead, and the failure is reported (`fail`) on the context that asked.
  const appContexts = new Map<string, ResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>>()
  const appContext = (target: ChainRef) => {
    const known = appContexts.get(target.id)

    if (known !== undefined) {
      return known
    }

    const created = createResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>({
      chain: target,
      normalize: lower,
      resolvers: {
        ...(app.names === undefined ? {} : {names: app.names}),
        ...(app.tokens === undefined ? {} : {tokens: app.tokens}),
      },
    })
    appContexts.set(target.id, created)

    return created
  }
  const fromApp = async <Answer>(
    target: ChainRef,
    resolver: 'names' | 'tokens',
    lookup: (context: ResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>) => Promise<Answer | undefined>
  ): Promise<Answer | undefined> => {
    const context = appContext(target)
    const answer = await lookup(context)

    if (context.failures().includes(resolver)) {
      contextFor(chainIdOf(target)).fail(resolver)
    }

    return answer
  }

  const resolvers: Resolvers<EthereumDescriptorQuery, Erc7730Descriptor> = {
    ...app,
    names: {
      name: async query =>
        (await fromApp(query.chain, 'names', context => context.name(query.address))) ??
        (builtins ? builtinName(query.chain, query.address) : undefined),
    },
    tokens: {
      token: async query =>
        (await fromApp(query.chain, 'tokens', context => context.token(query.address))) ??
        (builtins ? builtinToken(query.chain, query.address) : undefined),
    },
  }

  const make = (target: ChainRef) =>
    createResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>({
      chain: target,
      normalize: lower,
      resolvers,
      signer: options.signer,
    })
  const context = make(ref)
  const others = new Map<number, ResolverContext<EthereumDescriptorQuery, Erc7730Descriptor>>()
  const contextFor = (id: number) => {
    if (id === chainId) {
      return context
    }

    const known = others.get(id)

    if (known !== undefined) {
      return known
    }

    const created = make(chainRef(id))
    others.set(id, created)

    return created
  }

  const checksum = (address: string) => read(() => chain.checksumAddress(address), 'An address')

  return {
    address: async ({chainId: on, fallbackName, value, ...input}) => {
      const field = await contextFor(on ?? chainId).address({...input, value: checksum(value)})

      return field.relation === 'unknown' && fallbackName !== undefined
        ? {...field, name: fallbackName, relation: 'contract'}
        : field
    },
    chain,
    chainId,
    checksum,
    context,
    contextFor,
    native,
    nativeAmount: input => amountField({...input, baseUnit: 'wei', decimals: native.decimals, symbol: native.symbol}),
    options,
    ref,
    warnings: () => {
      const all = new Set([context, ...others.values()].flatMap(each => each.failures()))

      return all.size === 0
        ? []
        : [
            warning(WARNINGS.RESOLVER_FAILED, {
              params: {resolvers: RESOLVER_NAMES.filter(name => all.has(name)).join(', ')},
            }),
          ]
    },
  }
}
