# 1. Clear signing is a display model, with stable codes, computed risk and pluggable knowledge

Accepted.

## Context

A wallet about to sign holds bytes: an RLP transaction, EIP-712 typed data, a Solana message, a PSBT. The adapters in
[`@hzblj/nitro-crypto`](https://github.com/hzblj/nitro-crypto) parse them strictly (`parseTransaction`,
`hashTypedData`, `decodeMessage`, `decodePsbt`), and the air-gap signers in
[`@hzblj/crypto-airgap`](https://github.com/hzblj/crypto-airgap) review them before they sign, each with its own
warnings (`EthereumSignWarning`, `SolanaSignWarning`, `BitcoinSignWarning`). Parsed is not understood: a user still
reads `to: 0x68b3…, data: 0x095ea7b3…` and cannot tell an approval of everything they own from a transfer.

Clear signing turns what is signed into what it means: "Allow Uniswap to spend an unlimited amount of USDC", and that
it is the most dangerous kind of thing to sign. Industry efforts exist (Ledger's ERC-7730 descriptors for EVM calls
and typed data, Anchor and Codama IDLs for Solana programs), but each covers one chain and none says how a wallet
shows the result, warns, or ranks risk.

Four questions had to be answered: what a chain package returns, how its words reach a user in their language, how
risk is decided, and where knowledge the bytes do not carry (token symbols, names, descriptors) comes from.

## Decision

- **A model, not strings.** Every chain package returns a `ClearSigning`: an intent, a summary, ordered fields of
  typed kinds (an amount is a `bigint` with its decimals and symbol, an address has its relation to the signer, a
  deadline knows whether it passed), nested actions, warnings, a risk level, the source of the understanding, and the
  raw remainder. A string would be one UI's rendering, in one language, with the amount already rounded and the
  address already shortened. With a model, a phone shows a card, a hardware wallet's companion a list, a screen reader
  `plainText`, a test asserts on a field's value, and the air-gap signers can share one review. It is plain data
  (no class instances, deeply frozen, bigints documented) so it crosses any boundary inside an app.
- **One model for every chain.** The kinds of things worth showing are the same everywhere: amounts, addresses,
  moments, durations, raw bytes, a list. What differs is how they are read, which is the chain packages' job. A UI
  written against the model renders Ethereum, Solana and Bitcoin, and a chain added later, without change.
- **Nested actions, not flattened ones.** A multicall, an EIP-7702 batch, a Solana transaction's instructions and a
  PSBT's outputs are each several things signed at once. Flattening them would lose which approval belongs to which
  call; showing only the outer call would hide them. Actions nest, each with its fields, source and risk, and each
  warning says the action it was raised on.
- **Stable codes beside English.** Every word carries a code (`intent.approve`, `label.spender`,
  `UNLIMITED_APPROVAL`) and English with its params filled, plus the params. An app translates by code with the same
  params, branches on codes (a critical code may require a second confirmation), and tests assert on them, while an
  app without translations still shows English. Codes are grouped (`intent.`, `summary.`, `label.`, `unit.`) so a
  title and a sentence about the same thing never share one, and namespaced by chain (`ethereum.label.gasLimit`,
  `solana.OTHER_SIGNERS`) so packages never collide. Shared codes are the core's, and a chain code exists only for
  what no shared code says. A code is never reused for another meaning; a new one is a minor release. Words that are
  not the library's (a descriptor's labels) are marked `external` and never translated.
- **Risk is the maximum of the warnings, computed.** Five severities with written meanings, from `info` to
  `critical` ("everything it covers can be lost, now or later, without another signature"). An action's risk is the
  most serious severity at and below it; the result's is the most serious of all; `none` without warnings. No chain
  package sets a risk: every level a user sees is explained by a warning they can read, and two packages cannot rank
  the same situation differently by accident. Warnings are gathered at the root, most serious first, so a UI that
  reads only the top still shows a critical warning raised three calls deep.
- **Resolvers for what the bytes do not say.** Token symbols and decimals, names and the user's address book,
  descriptors (ERC-7730, IDLs), and the time. They are interfaces the app plugs in, not data the packages ship or
  fetch: what a wallet trusts is the wallet's decision, and a library that bundled a token list would be out of date
  and a target. None is required; every package works offline with its built-in decoders. They may answer
  synchronously or asynchronously, so every `clearSign*` function is async. A resolver that fails or answers nonsense
  counts as no answer (`RESOLVER_FAILED`), which only ever means less known and more warned, never less warned.
- **Resolvers are trust boundaries.** Their answers are shown as fact. The core checks their shape (decimals in range,
  no hidden characters, a known relation); it cannot check their truth. Documents say so everywhere they are
  configured, and the `source` of each action names the descriptor used.
- **Not understanding is a result.** A call nothing decodes is shown as far as it can be, with its raw data and
  `UNKNOWN_CONTRACT_CALL`. Errors are kept for payloads that cannot be signed at all (the adapter refuses them) or for
  another chain, so a wallet never shows less because it understood less.

## Consequences

- The core has no dependencies and knows no chain. The chain packages depend on it and on their adapters' published
  versions, and parse nothing the adapters parse.
- `@hzblj/crypto-airgap-<chain>`'s signer reviews can move onto this model: their warnings map to shared codes
  (`ALL_CHAINS_DELEGATION` and `NO_CHAIN_ID` to `ALL_CHAINS`, `DELEGATION` to `ASSET_OWNERSHIP_TRANSFER`) or to chain
  codes (`solana.OTHER_SIGNERS`, `bitcoin.FOREIGN_INPUTS`). That is a later change in that repository.
- Decoding is not simulation. A result says what a signature asks for, not what a contract will do with it; a
  simulator's balance changes would be another source of warnings, not a replacement for this.
- A descriptor can lie. The model shows where each part's understanding came from, and the documentation says to load
  descriptors only from trusted registries, but a wrong descriptor from a trusted source still produces a wrong
  description.
- The layout of `plainText` is for people and may change; tests in every package assert on the model.
