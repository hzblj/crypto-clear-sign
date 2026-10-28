# @hzblj/crypto-clear-sign-solana

Solana clear signing: legacy and v0 transactions (wire bytes or bare messages), text, Sign In With Solana and
off-chain messages, read through the chain client of `@hzblj/crypto-solana` into `@hzblj/crypto-clear-sign`'s
`ClearSigning`. [`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) is the shape of every export,
the naming, the codes, the tests and the README; the README is the user documentation, kept short, and the JSDoc in
`src/` the reference.

TypeScript over `@hzblj/crypto-clear-sign` (a dependency, `workspace:^`) and `@hzblj/crypto-solana` (a dependency,
`^0.3.0`, as `crypto-airgap-solana` has it; the app still makes the client and passes it in). `@hzblj/nitro-crypto` is
a peer, as everywhere: one native module per app; this package imports only its `/adapter` entry (Base58, UTF-8,
`isCryptoError`). It imports no native code and no other chain, and parses nothing the adapter parses: messages and
transactions with `decodeTransaction` and `decodeMessage` (lookup tables passed through), off-chain messages with
`decodeOffchainMessage`, associated token addresses with `associatedTokenAddress`. What it reads itself is instruction
data, Sign In With Solana text and IDLs.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The exports, and nothing internal. |
| `src/transaction.ts` | `clearSignTransaction`: lookup tables (option, then resolver), the scope, one action per instruction, the root (`sent`, fees, signers, nonce, intent) and its warnings. |
| `src/message.ts`, `src/siws.ts` | `clearSignMessage`: off-chain messages, transaction bytes in disguise, text, Sign In With Solana (parser, chain ids, host comparison). |
| `src/scope.ts` | What the decoders share: the `Scope` (resolver context, wallet, ledger of what is sent, associated and own token accounts), the `ActionBuilder` (accounts by role, the rest by role or as multisig signers, unresolved lookups, the program), `describeAddress`, `unknownAction`. |
| `src/decoders/` | One built-in decoder per program (`system.ts`, `token.ts` for Token and Token-2022, `associated-token.ts`, `compute-budget.ts`, `memo.ts`, `stake.ts`, `lookup-table.ts`, `loader.ts`), their shared warnings (`system.ts`'s `destinationWarning` and `handoverWarning`, `close.ts`), and `index.ts`, the registry with each `source.decoder` name. |
| `src/idl/` | `types.ts` (`SolanaIdl`), `decode.ts` (the bounded, never-throwing interpreter: `matchIdl`, `IDL_LIMITS`), `describe.ts` (a match into an action), `resolver.ts` (`createIdlResolver`, pre-0.30 discriminators). |
| `src/reader.ts` | The strict byte reader and `MalformedData`, which every decoder throws for data it cannot read. |
| `src/catalogs.ts` | `SOLANA_WARNINGS`, `SOLANA_TEXTS`, `SolanaWarningCode`. |
| `src/chain.ts`, `src/options.ts`, `src/programs.ts`, `src/tokens.ts` | CAIP-2 ids and adapter errors; options and their checks; program ids and `SOLANA_PROGRAMS`; `SOLANA_TOKENS` and the token resolver it backs. |
| `src/version.ts` | `VERSION`, synced from package.json by `scripts/sync-versions.mjs`; a test holds them equal. |
| `test/` | node:test via tsx on `createTestCryptoEngine` (WebAssembly). `support.ts` builds messages with the adapter and converts `@solana/kit` instructions; the program tests build with the `@solana-program/*` clients (parity). `samples.test.ts` compares real-world transactions' whole models; `hostile.test.ts` is the seeded fuzzing (transactions, every built-in program's data by its layouts, IDLs, messages); `package.test.ts` pins the exports, the catalogs' keys and the docs. `consumer.ts` is what `yarn pack:check` type-checks against the tarball. |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter, never trust a description that
  came with the payload.
- **One action per instruction, in order.** `result.actions[i]` is instruction `i`; nesting is inside an action (a
  token `batch`). Compute budget instructions are actions too, and the root adds their sum as `priorityFee`.
- **Built-in decoders come before descriptors.** A Solana program the package reads is never described by an IDL.
- **Decoders are strict.** Data must read to its last byte by the instruction's layout, accounts must be there:
  otherwise the decoder throws `MalformedData` and the instruction is shown raw with `UNKNOWN_CONTRACT_CALL`. Only
  `MalformedData` is caught for built-ins; anything else is a bug and surfaces.
- **IDLs never throw.** `matchIdl` catches everything and answers `undefined`, and `describeWithIdl` falls back to the
  raw action: an IDL that does not fit is ignored, not believed. Keep every bound in `IDL_LIMITS`, read own
  properties only, and keep type lookups in `Map`s.
- **Less known means more warned.** Without a `signer`, any signing account may be the user's
  (`mayBeUsers`); an account from a lookup table that was not given is nobody known. Signers and invoked programs are
  never looked up: a decoder that reads accounts by role must not let a looked-up account take a signer's role (the
  stake decoder skips one standing where an older layout has a sysvar).
- **Codes are stable.** The chain's own warnings are `defineWarnings('solana', …)`, its texts `defineTexts('solana',
  …)`; a shared code from the core wins over a new one. Never rename one; a new one is a minor release.
- **The root's field ids are API** (warnings point at them): `sent` (what the built-in decoders read leaving the
  wallet, a floor and never a simulation), `feePayer`, `fee`, `priorityFee`, `signers`, `recentBlockhash` or
  `nonceAccount`, `nonce`, `expiry`, and secondary `computeUnitLimit`, `computeUnitPrice`, `version`,
  `lookupTables`. Its intent is the one instruction that is not set-up (compute budget, memo, token account creation,
  the nonce's advance), else `intent.batch`.
- **Resolvers go through `createResolverContext`** (addresses compare by identity: Base58 is exact), so a failing
  resolver becomes `RESOLVER_FAILED`, never a crash. The lookup table resolver is this package's own; its failure is
  merged into the same `RESOLVER_FAILED` (`params.resolvers` includes `lookupTables`).

Docs copy has no em dashes.

## Asked of the core

- **Moments that are not deadlines.** `dateTimeField` marks any past moment `expired`, and `plainText` writes
  "(expired)". An issue time, a "not before" or a rate's start is past without having expired; this package passes the
  moment itself as `now` for those. A `deadline: false` (or a kind of moment) in the core would say it properly.
- **Shared sign-in codes.** `solana.SIGN_IN_DOMAIN_MISMATCH`, `SIGN_IN_ADDRESS_MISMATCH`, `SIGN_IN_CHAIN_MISMATCH`
  and `SIGN_IN_MALFORMED` say what EIP-4361 checks say on Ethereum; shared `SIGN_IN_*` codes would let one UI branch
  on both.
- **The `own` relation from the chain package.** The signer's own associated token accounts are `own` here although
  no names resolver said so; the core's docs describe `own` as the names resolver's answer only.
- **A durable or replayable signature.** `solana.DURABLE_NONCE` could be a shared "never expires and anyone can
  submit it" code if another chain has the same (an EVM signature without a nonce or deadline).
