/**
 * An ERC-7730 descriptor: the JSON of a clear signing metadata file, as the registry publishes it (version 2 of the
 * schema), rendered by `@ethereum-sourcify/clear-signing`. Typed loosely on purpose: a descriptor is untrusted input;
 * the package checks what binds it, the reference implementation the rest, and one that does not hold is not used.
 * `includes` must be merged before a resolver answers with it (`createDescriptorResolver` does).
 *
 * ```json
 * {
 *   "context": {"contract": {"deployments": [{"chainId": 1, "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7"}]}},
 *   "metadata": {"owner": "Example"},
 *   "display": {"formats": {"transfer(address to,uint256 value)": {"intent": "Send", "fields": [...]}}}
 * }
 * ```
 */
export type Erc7730Descriptor = {
  readonly $schema?: string
  /** A file to merge under this one: resolved by `createDescriptorResolver`, never fetched. */
  readonly includes?: string | readonly string[]
  /** What the descriptor binds to: `contract` (deployments) or `eip712` (deployments, domain, domain separator). */
  readonly context?: Readonly<Record<string, unknown>>
  /** `owner`, `contractName`, `info`, `token`, `constants`, `enums`, `maps`. */
  readonly metadata?: Readonly<Record<string, unknown>>
  /** `formats` by function signature or EIP-712 `encodeType`, and shared `definitions`. */
  readonly display?: Readonly<Record<string, unknown>>
}
