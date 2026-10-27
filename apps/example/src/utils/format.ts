/** `0x9858…da94`: enough to recognize an address in a list, never enough to trust one. */
export const shortAddress = (address: string, head = 6, tail = 4): string =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`

const UNITS = [
  ['year', 365 * 24 * 3_600_000],
  ['day', 24 * 3_600_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const

/**
 * How far `moment` is from `now`, in the largest whole unit: `in 30 days`, `5 minutes ago`, `now`. Beside the exact
 * moment, never instead of it.
 */
export const relativeTime = (moment: number, now: number): string => {
  const distance = Math.abs(moment - now)
  const [unit, size] = UNITS.find(([, length]) => distance >= length) ?? ['minute', 60_000]
  const count = Math.floor(distance / size)

  if (count === 0) {
    return 'now'
  }

  const amount = `${String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${unit}${count === 1 ? '' : 's'}`

  return moment > now ? `in ${amount}` : `${amount} ago`
}
