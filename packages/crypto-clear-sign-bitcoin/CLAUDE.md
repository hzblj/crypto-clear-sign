# @hzblj/crypto-clear-sign-bitcoin

Bitcoin clear signing: PSBTs (BIP-174 version 0, P2WPKH and Taproot) and messages (BIP-322, legacy BIP-137, CAIP-122
sign-in), read through the chain client of `@hzblj/crypto-bitcoin` into `@hzblj/crypto-clear-sign`'s `ClearSigning`.
The README is the reference (every field id, code and decoder); [`docs/chain-package-contract.md`](../../docs/chain-package-contract.md)
is the shape every chain package keeps.

TypeScript over `@hzblj/crypto-clear-sign` (`workspace:^`) and `@hzblj/crypto-bitcoin` (a **dependency**, `^0.3.0`,
as crypto-airgap's chain packages have it, not a peer as the contract suggests). `@hzblj/nitro-crypto` is a peer (one
engine per app; the app makes the client) and is imported only from `@hzblj/nitro-crypto/adapter`, whose entry loads
no native module. `@scure/btc-signer` (pinned) is a devDependency: an independent writer of the test PSBTs.

| Path | What it is |
| --- | --- |
| `src/index.ts` | The exports: `clearSignPsbt`, `clearSignMessage`, `BITCOIN_WARNINGS`, `BITCOIN_TEXTS`, `BITCOIN_CHAIN_IDS`, the `HIGH_FEE` defaults, the types. Pinned by `test/package.test.ts`. |
| `src/psbt.ts` | `clearSignPsbt`: inputs as root list fields, outputs as actions, the fee, locks, ownership and asset warnings, the root intent. |
| `src/ownership.ts` | Accounts (one address, an xpub account, a fingerprint) against a script and its PSBT derivations: own, verified, branch, false claims. |
| `src/transaction.ts` | Sighash readings, size estimates (or the finalized size), BIP-68 relative locks, BIP-125, lock time rules. |
| `src/runes.ts` | The runestone decoder, ord's `runestone.rs` line for line (varints, tags, edicts, flaws), rune names, where runes go. |
| `src/describe-runes.ts` | A runestone or cenotaph as an action. |
| `src/assets.ts` | The `assets` option (resolver or record), its answers checked, and where a coin's inscriptions (FIFO by sat) and runes go. |
| `src/message.ts` | `clearSignMessage`, the CAIP-122 sign-in parser, the address network check. |
| `src/chain.ts` | CAIP-2 ids (`testnet` option: testnet4 by default), names, BTC or tBTC. |
| `src/catalogs.ts` | `BITCOIN_WARNINGS`, `BITCOIN_TEXTS`, `BitcoinWarningCode`. |
| `src/bytes.ts` | Strict Base64, hex, UTF-8, script instructions (for `OP_RETURN` and runestones only: the adapter parses everything else). |
| `test/` | node:test via tsx on `createTestCryptoEngine` (WebAssembly). `support.ts` builds PSBTs with the adapter and with btc-signer (`btcSignerPsbt`), and runestone scripts. `runes.test.ts` carries ord's test cases; `hostile.test.ts` is the seeded fuzz. `consumer.ts` is what `yarn pack:check` type-checks against the tarball. |

## Rules

- **Describe what is signed, from the bytes that are signed.** Parse with the adapter (`decodePsbt`,
  `validateAddress`, `addressFromPublicKey`, `derivePublic`, `dustThreshold`, `finalizePsbt`); never trust a
  description that came with the payload. The only parsing here is what the adapter has no reader for: script
  pushes after `OP_RETURN`, runestones, CAIP-122 text, Base64.
- **The PSBT's derivations are claims.** An output is change only when its key pays its script, and is verified only
  by script or by deriving the key from an xpub account; a fingerprint match alone is `bitcoin.UNVERIFIED_CHANGE`.
- **Runes follow ord, not the spec's prose.** `ord`'s `Runestone::decipher` is the reference: flaw names, the order
  in which fields are taken, values a `take` refuses staying behind as even tags. A change there is a change here,
  with its test case.
- **Not knowing is a warning, not an error.** Malformed input the adapter refuses is `INVALID_INPUT` (its error the
  `cause`); anything that parses but is not understood is a result with its raw data and a warning.
- **Codes are stable.** Own warnings in `BITCOIN_WARNINGS` (`bitcoin.*`), own words in `BITCOIN_TEXTS`; a shared
  code wins over a new one. A test asserts every own code (`package.test.ts` checks that each is named in a test).
- **Resolvers** go through `createResolverContext` (addresses compared as they are: Bech32 is lowercase already). The
  `assets` option is this package's own: its failures are added to `RESOLVER_FAILED`'s `resolvers` param by hand.

## Asked of the core

- A way for a chain package to register a resolver of its own (here `assets`, by outpoint) with
  `createResolverContext`, so its answers are checked, cached and reported as `RESOLVER_FAILED` the same way as the
  shared ones. Meanwhile `src/assets.ts` checks and catches, and the PSBT adds `assets` to the warning's params.

## Asked of the adapter (`@hzblj/crypto-bitcoin`)

- Export its size estimate (`estimateVsize`, per input type): `src/transaction.ts` repeats its numbers.
- `decodePsbt` refuses a PSBT whose outputs are more than its inputs, which is how marketplace listings
  (SIGHASH_SINGLE|ANYONECANPAY offers) are shaped: a fee of `undefined` there would let them be reviewed.
- Final witnesses (or their sizes) in `decodePsbt`, for an exact size of a partly finalized PSBT.

Docs copy has no em dashes.
