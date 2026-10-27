import {warning} from '@hzblj/crypto-clear-sign'

import {SOLANA_WARNINGS} from '../catalogs'
import {type AccountRef, isUsers} from '../scope'

/**
 * `CLOSE_TO_OTHER` when an account closed sends what it holds to a recipient that is neither the user's nor the
 * account's owner (or authority); a recipient from a lookup table that was not given counts as another.
 */
export const closeWarning = (recipient: AccountRef, owner: AccountRef | undefined, fields: readonly string[]) =>
  isUsers(recipient) || (recipient.address !== undefined && recipient.address === owner?.address)
    ? undefined
    : warning(SOLANA_WARNINGS.CLOSE_TO_OTHER, {fields})
