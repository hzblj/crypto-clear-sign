import {createSelectorFunctions} from 'auto-zustand-selectors-hook'
import {create} from 'zustand'
import {persist} from 'zustand/middleware'
import {immer} from 'zustand/middleware/immer'

import {DEFAULT_SETTINGS} from '../../core'
import {createCustomStorage} from '../storage'
import {languageSlice, reviewSlice} from './slices'
import type {SettingsStore} from './types'

export const SETTINGS_STORE_VERSION = 1
export const SETTINGS_STORE_NAME = '@settings-store'

type Persisted = Pick<SettingsStore, 'builtins' | 'language' | 'resolvers' | 'signers'>

const settingsStore = create<SettingsStore>()(
  persist(
    immer((...store) => ({
      ...reviewSlice(...store),
      ...languageSlice(...store),
      resetSettings: () =>
        store[0](state => {
          state.builtins = DEFAULT_SETTINGS.builtins
          state.resolvers = DEFAULT_SETTINGS.resolvers
          state.signers = {}
          state.language = 'en'
        }),
    })),
    {
      name: SETTINGS_STORE_NAME,
      partialize: ({builtins, language, resolvers, signers}): Persisted => ({builtins, language, resolvers, signers}),
      storage: createCustomStorage<Persisted>(),
      version: SETTINGS_STORE_VERSION,
    }
  )
)

/** What the Settings tab changes: the signers, the resolvers, the language. Persisted. */
export const useSettingsStore = createSelectorFunctions(settingsStore)

export * from './types'
