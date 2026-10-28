---
'@hzblj/crypto-clear-sign-ethereum': minor
---

ERC-7730 descriptors are now rendered by `@ethereum-sourcify/clear-signing`, the reference implementation of the
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
