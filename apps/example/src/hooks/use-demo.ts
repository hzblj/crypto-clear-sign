import {useEffect, useState} from 'react'

import {type DemoAccounts, type DemoCrypto, demoAccounts, demoEngine} from '../core'

export type Demo =
  | {readonly status: 'loading'}
  | {readonly status: 'unavailable'; readonly message: string}
  | {readonly status: 'ready'; readonly crypto: DemoCrypto; readonly accounts: DemoAccounts}

/** The engine and the demo key's accounts, once they are derived. A missing native module is said, not thrown. */
export const useDemo = (): Demo => {
  const [demo, setDemo] = useState<Demo>(() => {
    const engine = demoEngine()

    return 'error' in engine ? {message: engine.error.message, status: 'unavailable'} : {status: 'loading'}
  })

  useEffect(() => {
    const engine = demoEngine()

    if ('error' in engine) {
      return
    }

    let live = true
    demoAccounts(engine.crypto).then(
      accounts => live && setDemo({accounts, crypto: engine.crypto, status: 'ready'}),
      error => live && setDemo({message: error instanceof Error ? error.message : String(error), status: 'unavailable'})
    )

    return () => {
      live = false
    }
  }, [])

  return demo
}
