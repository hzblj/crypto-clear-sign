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
| `@hzblj/crypto-clear-sign-ethereum` | Keccak-256 and ABI decoding against viem 2.57.11 (`keccak256`, `toFunctionSelector`, `decodeAbiParameters`, `decodeFunctionData` over random ABIs and values, and over mutated encodings); the ERC-7730 registry's own test cases (224, at the bundled commit) replayed through the bundled descriptors: 201 read as the reference formatter reads them, 22 by built-in decoders by design, 1 refused by the adapter (a broken checksum); hostile call data fuzzed. | Fixture, unit |
| `@hzblj/crypto-clear-sign-solana` | Instruction data built by `@solana/kit` 8.5.0's program clients (`@solana-program/system` 0.16.0, `token` 0.18.0, `token-2022` 0.20.0, `compute-budget` 0.20.0, `memo` 0.16.0, `stake` 0.11.0, `address-lookup-table` 0.16.0, `loader-v3` 0.8.0) read back field for field; v0 transactions with lookup tables and durable nonce transactions compiled by kit; off-chain messages (every v0 format, and v1) encoded by `@hzblj/crypto-solana`; a hand-written Anchor IDL covering every Borsh type, and pre-0.30 ones with Anchor's discriminators, given and computed. Real-world samples (an aggregator's v0 swap with and without its table and IDL, a drainer, a durable nonce transaction, Sign In With Solana) compared as whole models. Every warning raised and not raised on the model; stake's older layouts with sysvars from lookup tables not given; malformed transactions, hostile IDLs and sign-in edge cases on a fixed clock. Seeded fuzzing of transaction bytes, every built-in program's instruction data, IDLs with their data, and messages. A consumer type-checked against the packed tarball. | Fixture (kit), unit |
| `@hzblj/crypto-clear-sign-bitcoin` | PSBTs written by the adapter and by `@scure/btc-signer` 2.4.1 (the same transaction reads the same from both), on the engine as WebAssembly: every signature hash type on P2WPKH and Taproot inputs, mixed and foreign inputs, coins without values, change by address, extended key and fingerprint (and a false derivation the extended key catches), signed PSBTs sized by the adapter's finalizer, inscriptions and runes in protected coins, lock times on a fixed clock. Runestones against `ord`'s own test cases (`runestone.rs`, `varint.rs`, `rune.rs`, `spaced_rune.rs`). Messages and CAIP-122 sign-in. Seeded fuzzing of PSBTs, runestones and messages. A consumer type-checked against the packed tarball. | Fixture (btc-signer, ord), unit |
