# @hzblj/crypto-clear-sign-ethereum

Ethereum clear signing: transactions of every type the adapter parses (legacy, EIP-2930, EIP-1559, EIP-7702), EIP-712
typed data, EIP-191 messages (with Sign-In with Ethereum) and EIP-7702 authorizations, read through the chain client of
`@hzblj/crypto-ethereum` into `@hzblj/crypto-clear-sign`'s `ClearSigning`. Built-in decoders read the standard calls;
an ERC-7730 interpreter reads descriptors from the `descriptors` resolver; a curated set of registry descriptors ships
in the `/registry` entry point. [`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) is the shape
of every export, the naming, the codes, the tests and the README; the README is the user documentation.

`@hzblj/crypto-clear-sign` is a dependency (`workspace:^`), `@hzblj/crypto-ethereum` `^0.3.0` a dependency (as in
crypto-airgap's chain packages; only its types are imported), `@hzblj/nitro-crypto` a peer (one native module per app;
`/adapter` only, for `hex`, `utf8`, `bytes` and `isCryptoError`). viem is a devDependency pinned exactly, for parity
tests only. No native code, no network, no other chain.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The main entry's exports. |
| `src/transaction.ts`, `typed-data.ts`, `message.ts`, `authorization.ts` | The four `clearSign*` functions. |
| `src/env.ts` | Options (checked), `EthereumDescriptorQuery`, the chain reference, adapter errors as `ClearSignError` (`read`), the resolver context with the built-in token list and names behind the app's, one `RESOLVER_FAILED` across chains. |
| `src/calls/` | The call pipeline (`describe.ts`: built-in, then descriptor, then raw), the built-in decoders (`builtins.ts`, with `BUILTINS`), shared helpers (`common.ts`: unlimited, unknown call, native transfer, batch intent), deadlines (`time.ts`). |
| `src/erc7730/` | The ERC-7730 interpreter: `compile.ts` (strict validation into a compiled form, `$ref`s merged, cached per object), `path.ts`, `render.ts` (field formats, groups, visibility, interpolation, uncovered arguments), `apply.ts` (binding checks for calls and typed data), `resolver.ts` (`createDescriptorResolver`, `mergeDescriptors`, includes), `types.ts`. |
| `src/abi.ts`, `src/keccak.ts` | The ABI decoder (signatures, JSON ABIs, strict and bounded decoding) and Keccak-256 for selectors (the chain client exposes none). |
| `src/eip712.ts`, `src/siwe.ts`, `src/known.ts`, `src/catalogs.ts` | `encodeType`; the ERC-4361 parser; tokens, Permit2, Multicall3, WETH, chain names; `ETHEREUM_WARNINGS` and `ETHEREUM_TEXTS`. |
| `src/registry/` | The `/registry` entry: `index.ts`, and what `scripts/import-registry.mjs` writes: `descriptors/` (registry files, byte for byte), `manifest.json` (commit, paths, SHA-256), `files.ts`. Never edit those by hand: change `SELECTION` and re-import. |
| `test/` | node:test via tsx on `@hzblj/nitro-crypto/testing`, payloads built by viem. A file per export (`transaction`, `typed-data`, `message`, `authorization`), `builtins.test.ts` (every decoder, every warning and its near miss, nesting, a mainnet Uniswap swap), `resolvers.test.ts` (every export offline, sync, async, throwing, nonsense), `erc7730-compile.test.ts` (paths, compile rejections, includes, the resolver, fuzzing) and `erc7730-render.test.ts` (formats, visibility, groups, slices, interpolation, binding), `package.test.ts` (exports, codes, em dashes), `abi.test.ts` (Keccak and decoding against viem, fuzzing), `registry.test.ts` (the registry's own test cases, `test/vectors/registry/`, replayed), `helpers.ts`, `consumer.ts` (type-checked against the tarball). |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter (`parseTransaction`,
  `hashTypedData`, `hashAuthorization`), never trust a description that came with the payload.
- **Not knowing is a warning, not an error.** The adapter's refusals are `INVALID_INPUT`, `CHAIN_MISMATCH`,
  `UNSUPPORTED` (through `read`); anything that parses but is not understood is a result with its raw data and a
  warning. A decoder that cannot finish throws `Unreadable` (or `AbiError`), and the pipeline moves on.
- **Built-ins win over descriptors** for the same call: a descriptor never relabels an approval. Built-ins are bound
  by selector (WETH and Permit2 also by address).
- **A descriptor is untrusted input.** `compileDescriptor` checks everything it reads and throws `DescriptorError`;
  `render` throws it when the descriptor does not fit the data. Both mean `ethereum.INVALID_DESCRIPTOR` and the next
  reader, never a crash and never half a descriptor. Field-level trouble is the value raw with
  `ethereum.UNREADABLE_FIELD`.
- **Bounds everywhere:** ABI depth 32 and 20,000 values, call nesting 4, descriptor groups 8 deep and 512 nodes a
  format, 256 values a path, labels 128 characters, interpolated intents 512.
- **Codes are stable.** The chain's own warnings are `defineWarnings('ethereum', …)`, its texts
  `defineTexts('ethereum', …)`; a shared code from the core wins over a new one. Severity changes are in the README.
- **Field ids:** fixed lowerCamel for built-ins (`spender`, `amount`, `maxFee`), `<name>-<index>` for repeated ones,
  `data.<path>` and `container.<field>` for a descriptor's, `message.<member>` for typed data nothing reads.
- **Resolvers** only through the context `createEnv` makes (lowercase compare): the app's answer first, checked by
  the core, then the built-ins (unless `builtins: false`). An app resolver that throws or answers nonsense lets the
  built-ins answer and is reported with `context.fail`. Moments that are not deadlines are `dateTimeField({deadline:
  false})` (`pointInTime`).

## Asked of the core and the adapter

- The chain client exposes no bare Keccak-256, so `src/keccak.ts` computes selectors (tested against viem). An
  `EthereumChain.keccak256` in `@hzblj/crypto-ethereum` would let it go.

## Open

- The ABI decoder accepts bytes after a valid encoding, as the EVM ignores them on a direct call, and shows them
  nowhere. Showing them raw (they matter to ERC-2771 contracts called through a forwarder) is a later decision.

Docs copy has no em dashes.
