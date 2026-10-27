import type {StateCreator} from 'zustand'

import type {Language} from '../../config'
import type {ChainId, ReviewSettings} from '../../core'

export type ReviewSlice = ReviewSettings & {
  /** `undefined` goes back to the demo key's address; `''` is no signer. */
  setSigner: (chain: ChainId, signer: string | undefined) => void
  setResolvers: (on: boolean) => void
  setBuiltins: (on: boolean) => void
}

export type LanguageSlice = {
  language: Language
  setLanguage: (language: Language) => void
}

export type SettingsStore = ReviewSlice &
  LanguageSlice & {
    /** Back to the defaults: the demo key everywhere, every resolver on, English. */
    resetSettings: () => void
  }

type Creator<Slice> = StateCreator<SettingsStore, [['zustand/immer', never]], [], Slice>

export type CreateReviewSlice = Creator<ReviewSlice>
export type CreateLanguageSlice = Creator<LanguageSlice>
