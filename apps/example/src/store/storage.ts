import {createMMKV} from 'react-native-mmkv'
import {createJSONStorage, type PersistStorage} from 'zustand/middleware'

/**
 * The settings' file. Not encrypted: it holds public addresses and switches, nothing secret (the demo key is a
 * published phrase, and lives only in the engine's memory).
 */
export const storage = createMMKV({id: 'clear-sign-example', mode: 'single-process'})

/** Zustand's JSON storage over MMKV: synchronous, so a store is hydrated before its first render. */
export const createCustomStorage = <S>(): PersistStorage<S> | undefined =>
  createJSONStorage(() => ({
    getItem: (name: string) => storage.getString(name) ?? null,
    removeItem: (name: string) => {
      storage.remove(name)
    },
    setItem: (name: string, value: string) => storage.set(name, value),
  }))
