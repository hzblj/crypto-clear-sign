# @hzblj/crypto-clear-sign-ethereum

Ethereum clear signing: transactions of every type the adapter parses (legacy, EIP-2930, EIP-1559, EIP-7702), EIP-712
typed data, EIP-191 messages (with Sign-In with Ethereum) and EIP-7702 authorizations, read through the chain client of
`@hzblj/crypto-ethereum` into `@hzblj/crypto-clear-sign`'s `ClearSigning`. Built-in decoders read the standard calls;
ERC-7730 descriptors from the `descriptors` resolver (or, opted into, the online registry) read the rest, rendered by
`@ethereum-sourcify/clear-signing`, the reference implementation; a curated set of registry descriptors ships in the
`/registry` entry point. [`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) is the shape of every
export, the naming, the codes, the tests and the README; the README is the user documentation, kept short, and the
JSDoc in `src/` the reference.

`@hzblj/crypto-clear-sign` is a dependency (`workspace:^`), `@hzblj/crypto-ethereum` `^0.3.0` a dependency (as in
crypto-airgap's chain packages; only its types are imported), `@hzblj/nitro-crypto` a peer (one native module per app;
`/adapter` only, for `hex`, `utf8`, `bytes` and `isCryptoError`). `@ethereum-sourcify/clear-signing` `^0.3.0` (MIT,
Sourcify, the EF clear signing working group's implementation) renders descriptors; `@noble/hashes` (its own
dependency too, one copy) gives Keccak-256 for selectors, as the chain client exposes none. viem is a devDependency
pinned exactly, for parity tests only. No native code, no other chain, and no network unless the app passes
`sourcify.registry`.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The main entry's exports (and Sourcify's `fetchPrebuiltRegistryIndex` and option types, passed through). |
| `src/transaction.ts`, `typed-data.ts`, `message.ts`, `authorization.ts` | The four `clearSign*` functions. |
| `src/env.ts` | Options (checked, `sourcify` too), `EthereumDescriptorQuery`, the chain reference, adapter errors as `ClearSignError` (`read`), the resolver context with the built-in token list and names behind the app's, one `RESOLVER_FAILED` across chains. |
| `src/calls/` | The call pipeline (`describe.ts`: built-in, then descriptor, then raw), the built-in decoders (`builtins.ts`, with `BUILTINS`), shared helpers (`common.ts`: unlimited, unknown call, native transfer, batch intent), deadlines (`time.ts`). |
| `src/erc7730/` | The adapter over the reference implementation: `apply.ts` (finding a descriptor: the app's resolver, then online; binding checks, strict decoding first; the entry points), `sourcify.ts` (the two runs, the in-memory resolver, the probes, the bridge to the resolvers), `display.ts` (its display model into ours: field kinds, lists, nested calls, warnings), `binding.ts` (what a descriptor binds to, checked), `resolver.ts` (`createDescriptorResolver`, `mergeDescriptors`, includes), `types.ts`. |
| `src/abi.ts`, `src/generic.ts` | The ABI decoder (signatures, strict and bounded decoding, selectors) and any decoded value as a field. |
| `src/eip712.ts`, `src/siwe.ts`, `src/known.ts`, `src/catalogs.ts` | `encodeType`; the ERC-4361 parser; tokens, Permit2, Multicall3, WETH, chain names; `ETHEREUM_WARNINGS` and `ETHEREUM_TEXTS`. |
| `src/registry/` | The `/registry` entry: `index.ts`, and what `scripts/import-registry.mjs` writes: `descriptors/` (registry files, byte for byte), `manifest.json` (commit, paths, SHA-256), `files.ts`. Never edit those by hand: change `SELECTION` and re-import. |
| `test/` | node:test via tsx on `@hzblj/nitro-crypto/testing`, payloads built by viem. A file per export (`transaction`, `typed-data`, `message`, `authorization`), `builtins.test.ts` (every decoder, every warning and its near miss, nesting, a mainnet Uniswap swap), `resolvers.test.ts` (every export offline, sync, async, throwing, nonsense), `erc7730.test.ts` (formats as field kinds, the reference's warnings mapped, visibility, groups, slices, interpolation, binding, nested calls, the online path with `fetch` stubbed), `erc7730-resolver.test.ts` (includes, overrides, `rejected`, `__proto__`, fuzzing mutated descriptors and call data), `package.test.ts` (exports, codes, em dashes), `abi.test.ts` (decoding and selectors against viem, fuzzing), `registry.test.ts` (the registry's own test cases, `test/vectors/registry/`, replayed), `helpers.ts`, `consumer.ts` (type-checked against the tarball). |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter (`parseTransaction`,
  `hashTypedData`, `hashAuthorization`), never trust a description that came with the payload.
- **Not knowing is a warning, not an error.** The adapter's refusals are `INVALID_INPUT`, `CHAIN_MISMATCH`,
  `UNSUPPORTED` (through `read`); anything that parses but is not understood is a result with its raw data and a
  warning. A decoder that cannot finish throws `Unreadable` (or `AbiError`), and the pipeline moves on.
- **Built-ins win over descriptors** for the same call: a descriptor never relabels an approval. Built-ins are bound
  by selector (WETH and Permit2 also by address). A descriptor's nested calls (`calldata` fields) come back to the
  pipeline, so built-ins read them too, with their warnings.
- **ERC-7730 is the reference implementation's.** Never interpret a descriptor here: the adapter checks the binding
  (deployments, domain, domain separator), decodes the call data with the package's strict decoder before the
  reference sees it, and maps what the reference renders. It runs twice per descriptor: as written (the display), and
  with every field `raw` and tagged (the exact value under each field, which field it is, and through probe calls to a
  reserved address, each nested call's `amount` and `spender`). Anything that keeps it from rendering (a warning that
  is not `INTERPOLATION_ERROR`, a throw, runs that do not line up, a label that is not text) is
  `ethereum.INVALID_DESCRIPTOR` with the reason as `params.code`, never a crash and never half a descriptor.
- **The reference's warnings, mapped:** a descriptor not used is `ethereum.INVALID_DESCRIPTOR` (`ethereum.UNTRUSTED_DESCRIPTOR`
  for `NO_TRUSTED_ATTESTATION`); a field it could not read, `ethereum.UNREADABLE_FIELD` with `params.code`;
  `ADDRESS_TYPE_MISMATCH` is `ethereum.ADDRESS_TYPE_MISMATCH`; `UNKNOWN_TOKEN` the shared one; `DESCRIPTOR_FETCH_ERROR`
  and a failing fetch `RESOLVER_FAILED` (`descriptors`). `NO_DESCRIPTOR`, `UNKNOWN_ADDRESS` (the relation says it),
  `INTERPOLATION_ERROR` (no summary), `EMPTY_ARRAY`, `UNKNOWN_BLOCK` (a number of blocks) and `UNKNOWN_CHAIN` on a chain
  id field (named here) raise nothing.
- **Bounds everywhere:** ABI depth 32 and 20,000 values, call nesting 4, descriptor groups 8 deep and 512 nodes a
  format (checked before rendering), labels 128 characters, interpolated intents 1,024.
- **Codes are stable.** The chain's own warnings are `defineWarnings('ethereum', …)`, its texts
  `defineTexts('ethereum', …)`; a shared code from the core wins over a new one. Severity changes are in the README.
- **Field ids:** fixed lowerCamel for built-ins (`spender`, `amount`, `maxFee`), `<name>-<index>` for repeated ones,
  `data.<path>` (an element's index where the path iterates, `data.orders.1.amount`), `container.<field>`, `value`
  and `group.<n>` for a descriptor's, `message.<member>` for typed data nothing reads.
- **Resolvers** only through the context `createEnv` makes (lowercase compare): the app's answer first, checked by
  the core, then the built-ins (unless `builtins: false`). An app resolver that throws or answers nonsense lets the
  built-ins answer and is reported with `context.fail`. The reference asks for tokens, names and chains through the
  same context. Moments that are not deadlines are `dateTimeField({deadline: false})` (`pointInTime`).

## Built-in decoders

By `source.decoder`. Anything nothing reads is `UNKNOWN_CONTRACT_CALL` (a call: its contract, value and call data raw)
or `BLIND_SIGNING` (typed data, bytes).

| Decoder | Reads | Intent |
| --- | --- | --- |
| `native-transfer` | Ether with no call data | `send` |
| `contract-creation` | `to: null` | `deploy` |
| `erc20` | `transfer`, `transferFrom`, `approve`, `increaseAllowance`, `decreaseAllowance` (any contract) | `send`, `approve`, `revoke`, `ethereum.intent.decreaseAllowance` |
| `nft` | `setApprovalForAll` | `approve`, `revoke` |
| `erc721` | `safeTransferFrom` (3 and 4 arguments) | `send` |
| `erc1155` | `safeTransferFrom`, `safeBatchTransferFrom` | `send` |
| `weth` | `deposit`, `withdraw` on WETH (Ethereum, Sepolia, OP Mainnet, Base, Arbitrum One) | `ethereum.intent.wrap`, `unwrap` |
| `permit2` | Permit2's `approve` and `lockdown`; its `PermitSingle`, `PermitBatch` and transfer typed data (witness ones too) | `approve`, `revoke` |
| `multicall` | `multicall(bytes[])` and its deadline and block hash forms, Multicall3's aggregates | the one call's, else `batch` |
| `safe-multisend` | Safe's `multiSend(bytes)` | as above |
| `smart-account` | ERC-7821 and ERC-7579 `execute`, `executeBatch`, `execute(address,uint256,bytes)` | as above |
| `ownable` | `transferOwnership`, `renounceOwnership` | `transferOwnership`, `ethereum.intent.renounceOwnership` |
| `proxy` | `upgradeTo`, `upgradeToAndCall`, `changeAdmin` | `ethereum.intent.upgrade`, `transferOwnership` |
| `eip2612`, `dai-permit` | EIP-2612 `Permit`, DAI's permit | `approve`, `revoke` |
| `eip191`, `siwe` | Text messages, ERC-4361 sign-in requests | `signMessage`, `signIn` |
| `eip7702` | EIP-7702 authorizations, alone or in a transaction | `delegate`, `ethereum.intent.undelegate` |

Unlimited: an ERC-20 or EIP-2612 amount from `2^255` up, or exactly `maxUint(96)` or `maxUint(128)`; a Permit2 amount
from `2^159` up. A permit's deadline more than 30 days ahead, or never, is `LONG_LIVED`; one past `EXPIRED`. A
descriptor's dates are never marked expired. Multicall3's calls are made by Multicall3; a smart account's by the
account. Calls nest at most 4 deep.

## Asked of the reference implementation

- Nested calls: `format` recurses into `calldata` fields itself and reports their `amount` and `spender` nowhere; the
  probes recover them. A hook for embedded calls (or the inner transaction on `EmbeddedCalldata`) would let them go.
- Display values are strings: exact amounts and dates come from the raw run. Raw values on `DisplayField` would let
  that run go.
- `format` and `formatTypedData` return their inner promise without `await`, so a throw inside escapes their
  `try`; the adapter catches it.
- Typed data needs a verifying contract and a chain id, and `@.from` an account (a placeholder stands for "no signer",
  and a field that shows it makes the descriptor unusable). Byte slices only, no array slices. Strings in call data are
  read byte by byte (the adapter decodes them again as UTF-8). Nested field groups are refused. No limit on how far
  arrays are iterated (the strict decoder's 20,000 values bound it).

## Open

- The ABI decoder accepts bytes after a valid encoding, as the EVM ignores them on a direct call, and shows them
  nowhere. Showing them raw (they matter to ERC-2771 contracts called through a forwarder) is a later decision.

Docs copy has no em dashes.
