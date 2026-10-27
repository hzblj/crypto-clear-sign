# @hzblj/crypto-clear-sign-ethereum

Ethereum clear signing: transactions of every type the adapter parses (legacy, EIP-2930, EIP-1559, EIP-7702), EIP-712 typed data and EIP-191 messages, read through the chain client of `@hzblj/crypto-ethereum` into
`@hzblj/crypto-clear-sign`'s `ClearSigning`. **A stub so far**: `src/index.ts` exports `VERSION` only. Read
[`docs/chain-package-contract.md`](../../docs/chain-package-contract.md) before filling it in: it is the shape of every
export, the naming, the codes, the tests and the README.

TypeScript over `@hzblj/crypto-clear-sign` (a dependency, `workspace:^`) and `@hzblj/crypto-ethereum`'s `EthereumChain`
(a peer: the app's engine makes the client and passes it in). `@hzblj/nitro-crypto` is a peer, as everywhere: one native
module per app. It imports no native code and no other chain, and decodes nothing the adapter decodes: it reads
`parseTransaction` (every transaction type), `hashTypedData`, `checksumAddress`, `erc20`, and describes.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The exports: `clearSignTransaction`, `clearSignTypedData`, `clearSignMessage`, the chain's warning and text catalogs, its types. |
| `src/version.ts` | `VERSION`, synced from package.json by `scripts/sync-versions.mjs`; a test holds them equal. |
| `test/` | node:test via tsx, on `createTestCryptoEngine` from `@hzblj/nitro-crypto/testing` (the engine as WebAssembly). |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter, never trust a description that
  came with the payload.
- **Not knowing is a warning, not an error.** Malformed input the adapter refuses is `INVALID_INPUT`; anything that
  parses but is not understood is a result with its raw data and a warning.
- **Codes are stable.** The chain's own warnings are `defineWarnings('ethereum', …)`, its texts `defineTexts('ethereum', …)`;
  a shared code from the core wins over a new one.
- **Resolvers are optional and untrusted for availability:** go through `createResolverContext` (addresses compare by
  lowercase hex (EIP-55 is case only)), so a failing resolver becomes `RESOLVER_FAILED`, never a crash. Descriptors: ERC-7730 descriptors (`descriptors` resolver).

Docs copy has no em dashes.
