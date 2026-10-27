import type {ClearSigning} from '@hzblj/crypto-clear-sign'
import type {StateCreator} from 'zustand'

import type {ChainId, MessageFormat, PasteKind, ReviewRequest} from '../../core'

/** What the Paste tab's fields hold: kept when the tab is left, and filled by "Open in Paste" from a sample. */
export type PasteDraft = {
  readonly chain: ChainId
  readonly kind: PasteKind
  readonly format: MessageFormat
  readonly text: string
  /** The site asking, for a sign-in message: the connection's, as a wallet would know it. */
  readonly origin: string
  /** Bumped when the draft is replaced from outside, so the uncontrolled native fields remount with it. */
  readonly revision: number
}

/** A pasted request and its review, between the Paste tab and its review screen. */
export type PastedReview = {
  readonly request: ReviewRequest
  readonly result: ClearSigning
  readonly payload: {readonly label: string; readonly text: string}
  readonly now: number
}

export type PasteSlice = {
  draft: PasteDraft
  /** Edits from the fields themselves: no remount. */
  editDraft: (draft: Partial<Omit<PasteDraft, 'revision'>>) => void
  /** A whole new draft (from a sample, a cleared form): the fields remount with it. */
  replaceDraft: (draft: Omit<PasteDraft, 'revision'>) => void
  pasted: PastedReview | null
  setPasted: (pasted: PastedReview) => void
}

export type ReviewStore = PasteSlice

type Creator<Slice> = StateCreator<ReviewStore, [['zustand/immer', never]], [], Slice>

export type CreatePasteSlice = Creator<PasteSlice>
