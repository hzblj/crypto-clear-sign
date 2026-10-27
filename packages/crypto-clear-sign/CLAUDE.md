# @hzblj/crypto-clear-sign

The display model of clear signing, chain-agnostic: what every chain package returns and every UI renders. Headless:
no UI, no network, no React, no native code, and no dependencies, so it installs alone and runs in any JS engine.
Three chain packages and an example build on it at once: its public API is a contract, documented in its README, the
JSDoc in `src/` and [`docs/chain-package-contract.md`](../../docs/chain-package-contract.md). ADR 0001 says why.

| Path | What it is |
| --- | --- |
| `src/model.ts` | `ClearSigning`, `ClearSigningAction`, `ChainRef` (CAIP-2), `SigningKind`, `Source`, `ActionPath`. Types and `SIGNING_KINDS`. |
| `src/fields.ts` | The field union and its kinds, the constructors (`amountField`, …), `checkField` (the model's rules for a field, used by everything), `isField`, `formatField`. |
| `src/create.ts` | `createClearSigning`: checks a whole result, places warnings by action path, computes risk, freezes. `actionAt`, `warningsAt`, `hasWarning`, `findField`, `jsonReplacer`. |
| `src/warnings.ts` | `WARNINGS` (the shared codes), `defineWarnings` (a chain's, namespaced), `warning`, the code guards. |
| `src/text.ts`, `src/catalogs.ts` | `DisplayText` (code, English, params), `text`, `externalText`, `defineTexts`, `localize`; the shared `INTENTS`, `SUMMARIES`, `LABELS`. |
| `src/risk.ts` | Severities, risk levels, `maxRisk`, `compareRisk`. |
| `src/resolvers.ts` | The resolver interfaces, `ClearSignOptions`, `createResolverContext` (answers checked, failures caught, lookups cached, the clock read once). |
| `src/amount.ts`, `src/time.ts` | `formatAmount` (exact), `maxUint`; `fromUnixSeconds`, `checkDeadline`, `checkDuration`, formats. |
| `src/characters.ts` | `hasHiddenCharacters`, and the escaping `plainText` uses. |
| `src/plain-text.ts` | `plainText`: the whole result as accessible text. |
| `src/errors.ts` | `ClearSignError` and its codes. Messages never quote input. |
| `src/version.ts` | `VERSION`, synced from package.json by `scripts/sync-versions.mjs`; a test holds them equal. |
| `test/` | A file per module; `package.test.ts` pins the runtime exports and checks the docs for em dashes. `consumer.ts` is what `yarn pack:check` type-checks against the tarball. |

## Rules

- **Additive only.** A new field kind, signing kind, severity meaning, code or text is a minor release, and UIs are
  told to tolerate unknown ones. Renaming or removing anything, or changing a code's meaning, is a breaking change,
  and three packages and an app read these names.
- **Every rule lives in `checkField` / `createClearSigning`.** Constructors, `isField` and results all go through the
  same checks, which throw `INVALID_ARGUMENT` naming where (`result.actions[1].fields[0].decimals`), never the value.
- **Results are plain and frozen:** object literals and arrays only, `undefined` dropped, deep `Object.freeze`, the
  input never mutated. Bigints only where the model says (`amount.value`, `number.value`).
- **Risk is computed.** There is no way to set it: it is the maximum of the warnings at and below an action.
- **Resolver answers are untrusted for shape.** `createResolverContext` checks them; a failure is `RESOLVER_FAILED`,
  never an exception, and never fewer warnings.
- **No chain knowledge.** No addresses, selectors, programs or network ids here beyond the documented examples; those
  are the chain packages'.

Docs copy has no em dashes.
