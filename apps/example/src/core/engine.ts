import {CryptoError, createCryptoEngine, isCryptoError} from '@hzblj/nitro-crypto'

import {createDemoAdapters, type DemoAccounts, type DemoCrypto, openDemoAccounts} from './chains'

type Engine = {readonly crypto: DemoCrypto} | {readonly error: CryptoError}

let engine: Engine | undefined
let accounts: Promise<DemoAccounts> | undefined

/** The engine, once per run: a missing native module is a message on screen, not a crash at import. */
export const demoEngine = (): Engine => {
  if (!engine) {
    try {
      engine = {crypto: createCryptoEngine({adapters: createDemoAdapters()})}
    } catch (error) {
      engine = {error: isCryptoError(error) ? error : new CryptoError('NATIVE_UNAVAILABLE', undefined, {cause: error})}
    }
  }

  return engine
}

export const demoCrypto = (): DemoCrypto | null => {
  const current = demoEngine()

  return 'crypto' in current ? current.crypto : null
}

/** The demo key's accounts, derived once per run in the engine; a failure is retried on the next call. */
export const demoAccounts = (crypto: DemoCrypto): Promise<DemoAccounts> => {
  accounts ??= openDemoAccounts(crypto).catch(error => {
    accounts = undefined
    throw error
  })

  return accounts
}
