import {hasHiddenCharacters} from './characters'
import {invalid} from './errors'
import {type AddressField, type AmountField, addressField, amountField, type FieldCommon, isPlainObject} from './fields'
import type {ChainRef} from './model'
import {type Clock, isTime, systemClock} from './time'
import {WARNINGS, type WarningInput, warning} from './warnings'

/**
 * Resolvers are how an app tells a chain package what it knows: tokens, names, descriptors, the time. None is
 * required; without any, a chain package reads what its built-in decoders read, offline.
 *
 * **They are trust boundaries.** Whatever a resolver answers is shown to the user as fact: a token list that calls a
 * scam token "USDC", an address book entry an attacker planted, a descriptor that labels an approval "Claim reward",
 * each makes the screen lie. Load token lists, names and descriptors from sources the app trusts (signed registries,
 * the user's own address book), never from the dApp that asks for the signature, and never from the payload itself.
 *
 * A resolver may answer synchronously or with a promise; chain packages always await, so every `clearSign*` function
 * is async. A resolver that throws, rejects or answers with something malformed counts as no answer: the result is
 * what the rest could read, with `RESOLVER_FAILED`.
 */
export type MaybePromise<Value> = Value | Promise<Value>

/** A token to look up: the chain (its CAIP-2 id is the key) and the token's contract or mint. */
export type TokenQuery = {readonly chain: ChainRef; readonly address: string}

/** What a token list says of a token. */
export type TokenInfo = {
  /** 1 to 32 characters, none hidden. */
  readonly symbol: string
  /** A whole number from 0 to 255. */
  readonly decimals: number
  /** Up to 128 characters, none hidden. */
  readonly name?: string
}

export type TokenResolver = {
  /** The token at `query.address`, or `undefined` when the list does not have it. */
  readonly token: (query: TokenQuery) => MaybePromise<TokenInfo | undefined>
}

/** An address to name. */
export type NameQuery = {readonly chain: ChainRef; readonly address: string}

/** What an address is to the user, when a name resolver knows: see `AddressRelation`. */
export type NameRelation = 'own' | 'contact' | 'contract'

export type NameInfo = {
  /** 1 to 128 characters, none hidden. */
  readonly name: string
  readonly relation: NameRelation
}

export type NameResolver = {
  /** The user's own accounts and address book, and contract labels the app trusts; `undefined` when unknown. */
  readonly name: (query: NameQuery) => MaybePromise<NameInfo | undefined>
}

/** A descriptor a resolver found, and how a result names it in `source`. */
export type Descriptor<Content> = {
  /** Names it in the result's `source`: a registry path, a URL, a digest. 1 to 256 characters. */
  readonly id: string
  /** The descriptor itself, in the chain package's format (ERC-7730 JSON, an IDL). The chain package checks it. */
  readonly content: Content
  /** Who made it, for people: `Ledger registry`, `Uniswap`. Up to 128 characters, none hidden. */
  readonly publisher?: string
}

/** Finds descriptors: ERC-7730 for Ethereum, IDLs for Solana. Each chain package says what `Query` it asks with. */
export type DescriptorResolver<Query, Content> = {
  readonly descriptor: (query: Query) => MaybePromise<Descriptor<Content> | undefined>
}

/** What an app plugs in. `Query` and `Content` are the chain package's descriptor types (`never` for none). */
export type Resolvers<Query = never, Content = never> = {
  readonly tokens?: TokenResolver
  readonly names?: NameResolver
  readonly descriptors?: DescriptorResolver<Query, Content>
  /** For deadlines and expiries; `systemClock` unless given (tests give a fixed one). */
  readonly clock?: Clock
}

/** What every `clearSign*` function takes beside its payload. A chain package may add its own options. */
export type ClearSignOptions<Query = never, Content = never> = {
  /** The address that signs: it shows as `self`. */
  readonly signer?: string
  readonly resolvers?: Resolvers<Query, Content>
}

export const RESOLVER_NAMES = ['tokens', 'names', 'descriptors'] as const

export type ResolverName = (typeof RESOLVER_NAMES)[number]

/**
 * How a chain package reaches the resolvers, the same way in every package. `Own` names the chain package's own
 * resolvers it reports failures of (`ownResolvers`): none unless given.
 */
export type ResolverContext<Query = never, Content = never, Own extends string = never> = {
  readonly chain: ChainRef
  readonly signer?: string
  /** The clock read once, in milliseconds, when the context was made: every field of one result uses the same now. */
  readonly now: number
  /** Whether `address` is the signer's (by the chain's `normalize`). */
  readonly isSigner: (address: string) => boolean
  /** The token list's answer, checked; cached per address for the context's life. */
  readonly token: (address: string) => Promise<TokenInfo | undefined>
  /** The name resolver's answer, checked; cached per address. */
  readonly name: (address: string) => Promise<NameInfo | undefined>
  /** The descriptor resolver's answer, checked (not its `content`: that is the chain package's to check). */
  readonly descriptor: (query: Query) => Promise<Descriptor<Content> | undefined>
  /**
   * An address field with its name and relation: `self` for the signer, else the name resolver's (`own`, `contact`,
   * `contract`), else `token` when the token list has it, else `unknown`.
   */
  readonly address: (input: FieldCommon & {readonly value: string}) => Promise<AddressField>
  /** A token amount field with the token list's symbol and decimals, or neither when it does not know the token. */
  readonly amount: (
    input: FieldCommon & {readonly value: bigint; readonly token: string; readonly unlimited?: boolean}
  ) => Promise<AmountField>
  /**
   * The resolvers that failed so far, by a lookup or by `fail`: the shared ones in the order of `RESOLVER_NAMES`, then
   * the chain package's own in the order of `ownResolvers`.
   */
  readonly failures: () => readonly (ResolverName | Own)[]
  /**
   * Reports a failure the chain package finds itself, so that `warnings()` names it: a built-in list that stood in for
   * a resolver that threw, or a chain package's own resolver (`ownResolvers`) that threw or answered nonsense. Saying
   * it twice says it once. A name that is neither shared nor declared is `INVALID_ARGUMENT`, a caller's mistake.
   *
   * ```ts
   * const context = createResolverContext({chain, ownResolvers: ['assets'], ...options})
   * if (!isAssetList(answer)) context.fail('assets') // RESOLVER_FAILED then names it
   * ```
   */
  readonly fail: (resolver: ResolverName | Own) => void
  /** `RESOLVER_FAILED` when any resolver failed (its params name which), for the result's root; else nothing. */
  readonly warnings: () => readonly WarningInput[]
}

export type ResolverContextOptions<Query = never, Content = never, Own extends string = never> = ClearSignOptions<
  Query,
  Content
> & {
  readonly chain: ChainRef
  /**
   * How the chain compares addresses and keys its caches: lowercase for EVM hex, the identity (the default) for
   * Base58 and Bech32.
   */
  readonly normalize?: (address: string) => string
  /**
   * The chain package's own resolvers (Bitcoin's `assets`, Solana's `lookupTables`), by name, so that `fail` can
   * report them: `RESOLVER_FAILED` names them after the shared ones, in this order. lowerCamel, up to 32 characters,
   * none of `RESOLVER_NAMES`.
   */
  readonly ownResolvers?: readonly Own[]
}

const OWN_RESOLVER = /^[a-z][A-Za-z0-9]{0,31}$/

const readable = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !hasHiddenCharacters(value)

const checkToken = (value: unknown): TokenInfo | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (
    !isPlainObject(value) ||
    !readable(value.symbol, 32) ||
    typeof value.decimals !== 'number' ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 255 ||
    (value.name !== undefined && !readable(value.name, 128))
  ) {
    throw invalid('A token resolver answered with something that is not a token.')
  }

  return Object.freeze(
    value.name === undefined
      ? {decimals: value.decimals, symbol: value.symbol}
      : {decimals: value.decimals, name: value.name, symbol: value.symbol}
  )
}

const checkName = (value: unknown): NameInfo | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (
    !isPlainObject(value) ||
    !readable(value.name, 128) ||
    (value.relation !== 'own' && value.relation !== 'contact' && value.relation !== 'contract')
  ) {
    throw invalid('A name resolver answered with something that is not a name.')
  }

  return Object.freeze({name: value.name, relation: value.relation})
}

const checkDescriptor = <Content>(value: unknown): Descriptor<Content> | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (
    !isPlainObject(value) ||
    typeof value.id !== 'string' ||
    value.id === '' ||
    value.id.length > 256 ||
    value.content === undefined ||
    (value.publisher !== undefined && !readable(value.publisher, 128))
  ) {
    throw invalid('A descriptor resolver answered with something that is not a descriptor.')
  }

  return Object.freeze(
    value.publisher === undefined
      ? {content: value.content as Content, id: value.id}
      : {content: value.content as Content, id: value.id, publisher: value.publisher}
  )
}

/**
 * The resolvers of a `clearSign*` call, made safe to use: answers checked (a malformed one is a failure), failures
 * caught and remembered (`warnings()` reports them, with those the chain package reports through `fail`), token and
 * name lookups cached, the clock read once.
 *
 * ```ts
 * const context = createResolverContext({chain, normalize: address => address.toLowerCase(), ...options})
 * const spender = await context.address({id: 'spender', label: LABELS.spender, value: call.spender})
 * const amount = await context.amount({id: 'amount', label: LABELS.amount, token: to, value: call.amount})
 * // ...build the actions, then add context.warnings() to the root's
 * ```
 */
export const createResolverContext = <Query = never, Content = never, Own extends string = never>(
  options: ResolverContextOptions<Query, Content, Own>
): ResolverContext<Query, Content, Own> => {
  const {chain, resolvers = {}, signer} = options
  const normalize = options.normalize ?? ((address: string) => address)
  const now = (resolvers.clock ?? systemClock).now()

  if (!isTime(now)) {
    throw invalid('The clock answers with a moment in milliseconds.')
  }

  const own = options.ownResolvers ?? []

  if (
    !Array.isArray(own) ||
    new Set(own).size !== own.length ||
    !own.every(
      name =>
        typeof name === 'string' && OWN_RESOLVER.test(name) && !(RESOLVER_NAMES as readonly string[]).includes(name)
    )
  ) {
    throw invalid('ownResolvers are distinct lowerCamel names, none of them shared.')
  }

  // Every name a failure can be reported under, in the order RESOLVER_FAILED lists them.
  const known: readonly (ResolverName | Own)[] = [...RESOLVER_NAMES, ...own]
  const failed = new Set<ResolverName | Own>()
  const tokens = new Map<string, Promise<TokenInfo | undefined>>()
  const names = new Map<string, Promise<NameInfo | undefined>>()

  const ask = async <Answer>(
    resolver: ResolverName,
    question: () => unknown,
    check: (answer: unknown) => Answer | undefined
  ): Promise<Answer | undefined> => {
    try {
      return check(await question())
    } catch {
      failed.add(resolver)

      return undefined
    }
  }

  const cached = <Answer>(cache: Map<string, Promise<Answer>>, address: string, lookup: () => Promise<Answer>) => {
    const key = normalize(address)
    const known = cache.get(key)

    if (known !== undefined) {
      return known
    }

    const answer = lookup()
    cache.set(key, answer)

    return answer
  }

  const token = (address: string) =>
    resolvers.tokens === undefined
      ? Promise.resolve(undefined)
      : cached(tokens, address, () => ask('tokens', () => resolvers.tokens?.token({address, chain}), checkToken))

  const name = (address: string) =>
    resolvers.names === undefined
      ? Promise.resolve(undefined)
      : cached(names, address, () => ask('names', () => resolvers.names?.name({address, chain}), checkName))

  const isSigner = (address: string) => signer !== undefined && normalize(address) === normalize(signer)
  const failures = () => known.filter(resolver => failed.has(resolver))

  return Object.freeze({
    address: async ({value, ...common}: FieldCommon & {readonly value: string}) => {
      const named = await name(value)

      if (isSigner(value)) {
        return addressField({...common, name: named?.name, relation: 'self', value})
      }

      if (named !== undefined) {
        return addressField({...common, name: named.name, relation: named.relation, value})
      }

      const known = await token(value)

      return known === undefined
        ? addressField({...common, relation: 'unknown', value})
        : addressField({...common, name: known.name ?? known.symbol, relation: 'token', value})
    },
    amount: async ({
      token: address,
      ...input
    }: FieldCommon & {readonly value: bigint; readonly token: string; readonly unlimited?: boolean}) => {
      const known = await token(address)

      return amountField({...input, decimals: known?.decimals, symbol: known?.symbol, token: address})
    },
    chain,
    descriptor: (query: Query) =>
      resolvers.descriptors === undefined
        ? Promise.resolve(undefined)
        : ask('descriptors', () => resolvers.descriptors?.descriptor(query), checkDescriptor<Content>),
    fail: (resolver: ResolverName | Own) => {
      if (!known.includes(resolver)) {
        throw invalid('fail names a shared resolver or one of ownResolvers.')
      }

      failed.add(resolver)
    },
    failures,
    isSigner,
    name,
    now,
    ...(signer === undefined ? {} : {signer}),
    token,
    warnings: () =>
      failed.size === 0 ? [] : [warning(WARNINGS.RESOLVER_FAILED, {params: {resolvers: failures().join(', ')}})],
  })
}
