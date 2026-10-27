import {createSelectorFunctions} from 'auto-zustand-selectors-hook'
import {create} from 'zustand'
import {immer} from 'zustand/middleware/immer'

import {pasteSlice} from './slices'
import type {ReviewStore} from './types'

const reviewStore = create<ReviewStore>()(immer((...store) => ({...pasteSlice(...store)})))

/** The Paste tab in this run: its draft and the last review it made. Never persisted: a request is pasted again. */
export const useReviewStore = createSelectorFunctions(reviewStore)

export * from './types'
