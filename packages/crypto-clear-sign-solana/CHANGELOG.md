# @hzblj/crypto-clear-sign-solana

## 0.1.0

### Minor Changes

- [`985b3d6`](https://github.com/hzblj/crypto-clear-sign/commit/985b3d6deedfc078e17cfa86a7dc65769da0889c) Thanks [@hzblj](https://github.com/hzblj)! - Solana clear signing over `@hzblj/crypto-solana` 0.3.0. `clearSignTransaction` reads legacy and v0 transactions, the wire bytes a dApp sends or the bare message an air-gapped signer receives, with lookup tables from an option or a resolver, into one action per instruction and a root that says what the whole does: what the wallet sends, the fee payer, the fee and priority fee, the signers, and the blockhash or durable nonce. Built-in decoders read the System program, Token and Token-2022 (with the Token-2022 extensions they can describe, and the batch instruction as nested actions), Associated Token Account, Compute Budget, Memo, Stake, Address Lookup Table and the BPF Upgradeable Loader; any other program is read by an Anchor IDL the descriptors resolver gives (the 0.30 format, and the earlier one through `createIdlResolver`), within strict bounds, and ignored rather than believed when it does not fit; anything else is shown raw. `clearSignMessage` reads text, Sign In With Solana messages (checked against the site that asks, the signer, the cluster and the expiration time) and off-chain messages, and refuses to show transaction bytes as a message. Risk comes from the shared codes (an authority handed over, an unlimited approval, an unknown program, an unknown token or recipient, a high priority fee) and Solana's own: `solana.DURABLE_NONCE`, `solana.CLOSE_TO_OTHER`, `solana.PROGRAM_UPGRADE`, `solana.UNRESOLVED_LOOKUPS`, `solana.NOT_FEE_PAYER`, `solana.OTHER_SIGNERS`, `solana.MESSAGE_IS_TRANSACTION` and the `solana.SIGN_IN_*` codes. A small built-in token list (USDC, USDT, wrapped SOL, devnet USDC) backs the app's.

### Patch Changes

- Updated dependencies [[`985b3d6`](https://github.com/hzblj/crypto-clear-sign/commit/985b3d6deedfc078e17cfa86a7dc65769da0889c), [`1475f90`](https://github.com/hzblj/crypto-clear-sign/commit/1475f908df5a906ffe52e0388d4b6d9c32c45f4b)]:
  - @hzblj/crypto-clear-sign@0.1.0
