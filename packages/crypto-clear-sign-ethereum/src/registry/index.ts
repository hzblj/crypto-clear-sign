import {createDescriptorResolver, type Erc7730File, type Erc7730Resolver} from '../erc7730/resolver'
import {FILES} from './files'
import manifest from './manifest.json'

/**
 * Where the bundled descriptors come from: LedgerHQ's ERC-7730 registry (CC0-1.0), at one commit, each file with its
 * path and SHA-256 there. `scripts/import-registry.mjs` re-imports them.
 */
export const REGISTRY_SOURCE: {
  readonly repository: string
  readonly commit: string
  readonly license: string
  readonly files: readonly {readonly path: string; readonly role: string; readonly sha256: string}[]
} = Object.freeze({
  commit: manifest.commit,
  files: Object.freeze(manifest.files.map(file => Object.freeze({...file}))),
  license: manifest.license,
  repository: manifest.repository,
})

/**
 * The bundled ERC-7730 files: descriptors of the most used protocols in the registry (Uniswap's routers and Permit2,
 * 1inch, Aave, Lido, Morpho, LI.FI, Circle, KyberSwap, ParaSwap, Safe, Ethena, Sky, Tether, WETH) and the files they
 * include, by their paths in the registry. Pass them to `createDescriptorResolver`, with the app's own after them to
 * override or extend them. A separate entry point, so an app that does not want them does not ship them.
 */
export const ETHEREUM_REGISTRY: readonly Erc7730File[] = FILES

/**
 * A `descriptors` resolver over the bundled files, and `extra` files after them (which win where both bind):
 * `{resolvers: {descriptors: registryResolver()}}`. **The registry is a source the app chooses to trust:** its
 * descriptors are believed, and a descriptor can describe a call wrongly.
 */
export const registryResolver = (extra: readonly Erc7730File[] = []): Erc7730Resolver =>
  createDescriptorResolver([...FILES, ...extra])
