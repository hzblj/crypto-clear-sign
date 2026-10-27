# crypto-clear-sign

Turborepo + Yarn 4 workspaces for **`@hzblj/crypto-clear-sign`** and its chain packages: clear signing as data (what a
wallet is about to sign, read into one display model with an intent, fields, nested actions, warnings with stable
codes and a computed risk) for React Native and Expo. The engine and the chain adapters that parse what is signed are
[`@hzblj/nitro-crypto`](https://github.com/hzblj/nitro-crypto)'s, taken from npm.

Every package has its own `CLAUDE.md`: read that one before touching it. A chain package's work starts at
[`docs/chain-package-contract.md`](docs/chain-package-contract.md).

| Path | Package | What lives there |
| --- | --- | --- |
| `packages/crypto-clear-sign/` | `@hzblj/crypto-clear-sign` | The display model, its checks (`createClearSigning`), field constructors, shared codes and texts, resolver interfaces and context, exact amounts, `plainText`. Headless, no dependencies. ADR 0001. |
| `packages/crypto-clear-sign-bitcoin/`, `-ethereum/`, `-solana/` | `@hzblj/crypto-clear-sign-*` | Each chain's `clearSign*` functions, reading through that chain's client into the model. |
| `apps/example/` | `crypto-clear-sign-example` (private) | The example app (not here yet). Runs the packages from **source**. |
| `scripts/` | | `pack-check.mjs` (packs, installs, type-checks each package's `test/consumer.ts`), `sync-versions.mjs`. |
| `docs/` | | The chain package contract, compatibility, the decisions (`adr/`). `SECURITY.md` is at the root. |

Dependencies point down: example → `@hzblj/crypto-clear-sign-<chain>` → (`@hzblj/crypto-clear-sign`, and as peers that
chain's adapter and `@hzblj/nitro-crypto`). The core imports nothing. A package here never imports another chain's
package, never fetches, and parses nothing its adapter parses.

## Commands

```bash
yarn test                    # every workspace's tests; the chain packages on @hzblj/nitro-crypto/testing (WebAssembly)
yarn typecheck / yarn lint   # tsc, Biome
yarn pack:check              # what npm receives, and each package's test/consumer.ts against its tarball
yarn changeset               # describe a change for the next release
```

## Conventions that bite

**Not understanding is a result, not an error.** A chain package throws `ClearSignError` only when nothing could be
signed (`INVALID_INPUT`, `CHAIN_MISMATCH`, `UNSUPPORTED`); anything that parses but is not understood is described
with its raw data and a warning. Risk is never set by hand: `createClearSigning` computes it from the warnings.

**Codes are an API.** Warning codes (`UNLIMITED_APPROVAL`, `ethereum.CONTRACT_CREATION`) and text codes
(`intent.approve`, `ethereum.label.gasLimit`) are what apps translate and branch on. Never rename or reuse one; a new
one is a minor release. A chain code only for what no shared code says.

**Resolvers are trust boundaries.** Whatever they answer is shown as fact. Chain packages reach them only through
`createResolverContext`, which checks shapes and turns failures into `RESOLVER_FAILED`.

**The engine comes from npm.** `@hzblj/nitro-crypto` and `@hzblj/crypto-<chain>` are the chain packages' peers (the
app makes the client and passes it in) and devDependencies at the versions in each `package.json`. A change the
packages need there is a release of nitro-crypto first. Their published `exports` have no `source` condition; the
tests here run with `--conditions=source` and reach only this repository's sources.

**The example runs the packages' source; the world runs `build/`.** Every package's `exports` names a `source` entry
for the example's Metro and tsconfig `paths`. `publishConfig.exports` is the published map without it, and the pack
check refuses a tarball that names it.

**`tsconfig.base.json` writes out `expo/tsconfig.base`'s options**, so the packages type-check without Expo installed;
the example may extend `expo/tsconfig.base` on top of it.

**Publish through Yarn, tag through changesets.** `yarn release` builds, runs `yarn npm publish` in every public
workspace and then `changeset tag`. Never `changeset publish`: its npm call would ship `workspace:` ranges verbatim.
`changeset:version` also syncs each package's `src/version.ts`.

**Docs copy has no em dashes.** Not in the READMEs, the JSDoc in `src/` (it is the API reference), changesets or the
example's captions. Rewrite with a comma, a colon, parentheses or a second sentence. Code comments are exempt.

**Commits are Jan's alone.** Author `Jan Blazej <hello@janblazej.dev>` (set locally in this repo), no co-author or
generated-by lines.

Code style is Biome-enforced (`@hzblj/biome-config`): 2 spaces, 120 cols, single quotes, no semicolons, sorted imports
and object keys. Named exports and `const` arrow functions; `type` over `interface`.
