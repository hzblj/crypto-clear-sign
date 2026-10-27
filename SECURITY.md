# Security

> [!WARNING]
> **Not security audited. Do not use with real funds.** crypto-clear-sign is a foundation and a demonstration: its
> model and checks are real, but no independent party has reviewed this code, and a description is only as good as
> the decoders and descriptors behind it.

## Reporting a vulnerability

Please report privately, through GitHub's [private vulnerability reporting](https://github.com/hzblj/crypto-clear-sign/security/advisories/new)
on this repository, not in a public issue. Include what you found, how to reproduce it, and which version. You will get
an acknowledgement, and a fix or an explanation, as soon as it can be worked out; a confirmed issue is disclosed in the
changelog and a GitHub advisory once a fixed version is published.

Parsing what is signed (transactions, typed data, messages, PSBTs), keys and signatures are
[`@hzblj/nitro-crypto`](https://github.com/hzblj/nitro-crypto)'s and its chain adapters': report anything about them
there.

## What clear signing protects, and what it does not

Clear signing is a security feature: it shows a person what a signature does before they give it, so that "approve
everything" cannot pass as "claim a reward". It has limits, and a wallet that relies on it should know them.

- **Decoding is not simulation.** A result says what the signature asks for: the call, its arguments, the approval,
  the outputs. It does not say what will happen on chain. A contract can do something other than its interface
  suggests, a token can take a fee on transfer, a call can depend on state that changes before it lands. Balance
  changes are a simulator's job, against current chain state; the packages here never touch the network.
- **A descriptor can lie.** ERC-7730 descriptors and IDLs say what a call means in words their authors chose. A
  malicious or mistaken descriptor can label an approval "Claim reward" and the review will say so, with the model's
  full authority. Each action's `source` names the descriptor that described it; load descriptors only from registries
  the app trusts, never from the dApp asking for a signature.
- **Every resolver is a trust boundary.** Token lists, names and the address book are shown as fact. A token list that
  calls a counterfeit token "USDC", or an address book entry planted by an attacker, makes the screen lie. The core
  checks the shape of each answer (decimals in range, no hidden characters, a known relation), not its truth.
- **Not understanding is never hidden.** What no decoder or descriptor reads is shown as raw data with a warning
  (`UNKNOWN_CONTRACT_CALL`, `BLIND_SIGNING`), and a failing resolver means less is known and more is warned, never
  less. Risk is computed from the warnings, so every level shown has a reason the user can read.
- **What is described is what is signed.** Chain packages read the bytes that will be signed, through the adapters'
  strict parsers, and never a description that came with them. A result made elsewhere and received is the sender's
  word: make it on the device that signs.
- **Text is hostile.** Messages, labels and names are checked for control, invisible and direction-changing
  characters (`HIDDEN_CHARACTERS`), and `plainText` writes them escaped. Error messages never quote a payload.

Not covered: what the screen shows and what the person reads. A compromised device can draw anything; the review on
the device that holds the key (a hardware wallet, an air-gapped signer) is the one that counts.
