import type {CreatePasteSlice} from '../types'

export const pasteSlice: CreatePasteSlice = set => ({
  draft: {chain: 'ethereum', format: 'text', kind: 'transaction', origin: '', revision: 0, text: ''},
  editDraft: draft =>
    set(state => {
      Object.assign(state.draft, draft)
    }),
  pasted: null,
  replaceDraft: draft =>
    set(state => {
      state.draft = {...draft, revision: state.draft.revision + 1}
    }),
  setPasted: pasted =>
    set(state => {
      // Frozen by the package that made it, bigints and all: stored as it is, never drafted.
      state.pasted = pasted as typeof state.pasted
    }),
})
