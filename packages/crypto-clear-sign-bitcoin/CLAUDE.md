# @hzblj/crypto-clear-sign-bitcoin

Bitcoin clear signing: PSBTs (P2WPKH and Taproot inputs, any output) and messages (BIP-322 and legacy), read through the chain client of `@hzblj/crypto-bitcoin` into
`@hzblj/crypto-clear-sign`'s `ClearSigning`. **A stub so far**: `src/index.ts` exports `VERSION` only. Read
[`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) before filling it in: it is the shape of every
export, the naming, the codes, the tests and the README.

TypeScript over `@hzblj/crypto-clear-sign` (a dependency, `workspace:^`) and `@hzblj/crypto-bitcoin`'s `BitcoinChain`
(a peer: the app's engine makes the client and passes it in). `@hzblj/nitro-crypto` is a peer, as everywhere: one native
module per app. It imports no native code and no other chain, and decodes nothing the adapter decodes: it reads
`decodePsbt` (BIP-174 with BIP-371's Taproot fields), `validateAddress`, and describes.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The exports: `clearSignPsbt`, `clearSignMessage`, the chain's warning and text catalogs, its types. |
| `src/version.ts` | `VERSION`, synced from package.json by `scripts/sync-versions.mjs`; a test holds them equal. |
| `test/` | node:test via tsx, on `createTestCryptoEngine` from `@hzblj/nitro-crypto/testing` (the engine as WebAssembly). |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter, never trust a description that
  came with the payload.
- **Not knowing is a warning, not an error.** Malformed input the adapter refuses is `INVALID_INPUT`; anything that
  parses but is not understood is a result with its raw data and a warning.
- **Codes are stable.** The chain's own warnings are `defineWarnings('bitcoin', …)`, its texts `defineTexts('bitcoin', …)`;
  a shared code from the core wins over a new one.
- **Resolvers are optional and untrusted for availability:** go through `createResolverContext` (addresses compare by
  the identity (Bech32 addresses are lowercase already)), so a failing resolver becomes `RESOLVER_FAILED`, never a crash. Descriptors: no descriptors.

Docs copy has no em dashes.
