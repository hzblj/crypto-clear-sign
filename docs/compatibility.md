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
| `@hzblj/crypto-clear-sign-solana` | Not written yet. | |
| `@hzblj/crypto-clear-sign-bitcoin` | PSBTs written by the adapter and by `@scure/btc-signer` 2.4.1 (the same transaction reads the same from both), on the engine as WebAssembly: every signature hash type on P2WPKH and Taproot inputs, mixed and foreign inputs, coins without values, change by address, extended key and fingerprint (and a false derivation the extended key catches), signed PSBTs sized by the adapter's finalizer, inscriptions and runes in protected coins, lock times on a fixed clock. Runestones against `ord`'s own test cases (`runestone.rs`, `varint.rs`, `rune.rs`, `spaced_rune.rs`). Messages and CAIP-122 sign-in. Seeded fuzzing of PSBTs, runestones and messages. A consumer type-checked against the packed tarball. | Fixture (btc-signer, ord), unit |
