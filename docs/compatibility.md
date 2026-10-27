# Compatibility

| | Version | Notes |
| --- | --- | --- |
| `@hzblj/nitro-crypto` | 0.1.5 or later | A peer dependency of the chain packages: the engine behind the chain clients they are given. |
| `@hzblj/crypto-bitcoin`, `-ethereum`, `-solana` | 0.3.0 or later | Peer dependencies of the chain packages: the app makes the client (`crypto.chains.ethereum`) and passes it in. 0.3.0 parses every Ethereum transaction type, v0 Solana messages and off-chain messages, and PSBTs with BIP-371's Taproot fields. |
| React Native, Expo | As `@hzblj/nitro-crypto` | The packages are TypeScript without native code; the engine sets the floor ([its compatibility](https://github.com/hzblj/nitro-crypto/blob/main/docs/compatibility.md)). `@hzblj/crypto-clear-sign` alone runs in any JavaScript engine. |
| Node.js | 22 | For the tooling and the tests (the chain packages' on the engine as WebAssembly, `@hzblj/nitro-crypto/testing`). |

## What was tested

What each package was tested against. A row says "fixture" when the evidence is an independent implementation's
output, and "unit" when it is this repository's own tests.

| Package | Evidence | Kind |
| --- | --- | --- |
| `@hzblj/crypto-clear-sign` | The model's checks, every helper and type guard, exact amounts to 255 decimals, deadlines on a fixed clock, hidden characters by class, resolvers that throw, reject and answer nonsense, and a consumer type-checked against the packed tarball. | Unit |
| `@hzblj/crypto-clear-sign-ethereum` | Not written yet. | |
| `@hzblj/crypto-clear-sign-solana` | Instruction data built by `@solana/kit` 8.5.0's program clients (`@solana-program/system` 0.16.0, `token` 0.18.0, `token-2022` 0.20.0, `compute-budget` 0.20.0, `memo` 0.16.0, `stake` 0.11.0, `address-lookup-table` 0.16.0, `loader-v3` 0.8.0) read back field for field; v0 transactions with lookup tables and durable nonce transactions compiled by kit; off-chain messages encoded by `@hzblj/crypto-solana`; a hand-written Anchor IDL covering every Borsh type, and a pre-0.30 one with Anchor's discriminators. Malformed transactions, hostile IDLs and Sign In With Solana edge cases on a fixed clock. | Fixture and unit |
| `@hzblj/crypto-clear-sign-bitcoin` | Not written yet. | |
