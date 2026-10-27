# @hzblj/crypto-clear-sign-solana

Solana clear signing: legacy and v0 transactions (wire transactions and bare messages), message bytes and off-chain messages, read through the chain client of `@hzblj/crypto-solana` into
`@hzblj/crypto-clear-sign`'s `ClearSigning`. **A stub so far**: `src/index.ts` exports `VERSION` only. Read
[`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) before filling it in: it is the shape of every
export, the naming, the codes, the tests and the README.

TypeScript over `@hzblj/crypto-clear-sign` (a dependency, `workspace:^`) and `@hzblj/crypto-solana`'s `SolanaChain`
(a peer: the app's engine makes the client and passes it in). `@hzblj/nitro-crypto` is a peer, as everywhere: one native
module per app. It imports no native code and no other chain, and decodes nothing the adapter decodes: it reads
`decodeTransaction`, `decodeMessage` (legacy and v0, with instruction summaries), `decodeOffchainMessage`, and describes.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The exports: `clearSignTransaction`, `clearSignMessage`, the chain's warning and text catalogs, its types. |
| `src/version.ts` | `VERSION`, synced from package.json by `scripts/sync-versions.mjs`; a test holds them equal. |
| `test/` | node:test via tsx, on `createTestCryptoEngine` from `@hzblj/nitro-crypto/testing` (the engine as WebAssembly). |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter, never trust a description that
  came with the payload.
- **Not knowing is a warning, not an error.** Malformed input the adapter refuses is `INVALID_INPUT`; anything that
  parses but is not understood is a result with its raw data and a warning.
- **Codes are stable.** The chain's own warnings are `defineWarnings('solana', …)`, its texts `defineTexts('solana', …)`;
  a shared code from the core wins over a new one.
- **Resolvers are optional and untrusted for availability:** go through `createResolverContext` (addresses compare by
  the identity (Base58 is exact)), so a failing resolver becomes `RESOLVER_FAILED`, never a crash. Descriptors: IDLs (`descriptors` resolver).

Docs copy has no em dashes.
