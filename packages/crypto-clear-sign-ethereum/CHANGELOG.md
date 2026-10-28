# @hzblj/crypto-clear-sign-ethereum

## 0.2.0

### Minor Changes

- [`352a53e`](https://github.com/hzblj/crypto-clear-sign/commit/352a53e7286d1dd0f2505448d8eb190e55f2be0d) Thanks [@hzblj](https://github.com/hzblj)! - ERC-7730 descriptors are now rendered by `@ethereum-sourcify/clear-signing`, the reference implementation of the
  Ethereum Foundation's clear signing working group, instead of the package's own interpreter. The package keeps what is
  its own: built-in decoders that read the standard calls first (a descriptor still never relabels an approval), the
  risk warnings, the one display model, the bundled descriptors offline, and Sign-In with Ethereum, EIP-7702, permits
  and multicalls. A descriptor's nested calls are now described by the built-ins too, typed data's included (a Safe
  transaction's inner call, with its ether).

  - New option `sourcify`, off unless given: the registry on GitHub (`registry: {index}`, with
    `fetchPrebuiltRegistryIndex` now exported), `trustedTokens`, and the ERC-8176 attestation policy (`attestations`,
    `chainClient`), asked only when the `descriptors` resolver has nothing. Nothing is fetched otherwise.
  - New warnings: `ethereum.UNTRUSTED_DESCRIPTOR` (medium: an online descriptor no trusted auditor attests) and
    `ethereum.ADDRESS_TYPE_MISMATCH` (medium: an address the names resolver knows as another kind than the descriptor
    expects). `ethereum.INVALID_DESCRIPTOR` and `ethereum.UNREADABLE_FIELD` now carry the reference's reason as
    `params.code`.
  - `createDescriptorResolver`, `registryResolver` and `mergeDescriptors` keep their meaning; `rejected` lists files
    that are malformed in what binds them (context, deployments, format keys), as the reference checks the rest when it
    renders.
  - Behaviour that follows the reference: version 1 descriptors (an ABI, formats by name or selector, `required`,
    `excluded`) are no longer read; every field needs a `format`; arguments a descriptor does not mention are no longer
    listed (the standard requires a descriptor to cover them); typed data without a verifying contract is not read by
    descriptors; array slices are not read (byte slices are).
  - Selectors use Keccak-256 from `@noble/hashes`; the package's own Keccak is gone.
  - The README is short: install, a quick start, the API and options, descriptors bundled, your own or online, the
    warning codes, and what is not supported.

### Patch Changes

- Updated dependencies [[`461517c`](https://github.com/hzblj/crypto-clear-sign/commit/461517c7a9c28f0020cad85b40cdcf111362fa58)]:
  - @hzblj/crypto-clear-sign@0.1.1

## 0.1.0

### Minor Changes

- [`985b3d6`](https://github.com/hzblj/crypto-clear-sign/commit/985b3d6deedfc078e17cfa86a7dc65769da0889c) Thanks [@hzblj](https://github.com/hzblj)! - Ethereum clear signing over `@hzblj/crypto-ethereum` 0.3.0. `clearSignTransaction`, `clearSignTypedData`, `clearSignMessage` and `clearSignAuthorization` read transactions of every type the adapter parses (legacy, EIP-2930, EIP-1559, EIP-7702, contract creation), EIP-712 typed data, `personal_sign` messages and EIP-7702 authorizations through the chain client into `@hzblj/crypto-clear-sign`'s display model, so that the bytes described are the bytes signed. Built-in decoders read native transfers, ERC-20 transfers and approvals (unlimited at the top half of the range), `setApprovalForAll` and ERC-721 and ERC-1155 transfers, WETH, Permit2's calls and every Permit2 signature (witness variants too), EIP-2612 and DAI permits, multicalls, Multicall3, Safe's MultiSend and smart account batches as nested actions, ownership transfers and proxy upgrades, and Sign-In with Ethereum, checked against the signer, the chain and the site asking. Everything else is read by ERC-7730 descriptors (versions 1 and 2: binding, metadata, constants, enums and maps, every field format, groups, visibility, paths with slices, interpolated intents, nested call data, `$ref` and `includes`), checked strictly as untrusted input; what nothing reads is shown raw with `UNKNOWN_CONTRACT_CALL` or `BLIND_SIGNING`. Risk comes from shared warnings and eleven of the package's own (`ethereum.UNKNOWN_SPENDER`, `ethereum.UNEXPECTED_VALUE`, the sign-in mismatches, among others), with fees, deadlines, unknown tokens and destinations, hidden characters and all-chain signatures. Call data is decoded by its own strict, bounded ABI decoder, which matches viem's on valid encodings. `createDescriptorResolver` builds a resolver from descriptor files, and the `/registry` entry point bundles 25 descriptors of the most used protocols from the CC0 ERC-7730 registry (Uniswap, 1inch, Aave, Lido, Morpho, LI.FI, Circle, KyberSwap, ParaSwap, Safe and others), with their commit and hashes and a script that re-imports them. A small built-in token list (USDC, USDT, DAI, WETH, WBTC; Sepolia's test tokens) backs the app's own.

### Patch Changes

- Updated dependencies [[`985b3d6`](https://github.com/hzblj/crypto-clear-sign/commit/985b3d6deedfc078e17cfa86a7dc65769da0889c), [`1475f90`](https://github.com/hzblj/crypto-clear-sign/commit/1475f908df5a906ffe52e0388d4b6d9c32c45f4b)]:
  - @hzblj/crypto-clear-sign@0.1.0
