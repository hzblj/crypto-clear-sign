/** `0x9858…da94`: enough to recognize an address in a list, never enough to trust one. */
export const shortAddress = (address: string, head = 6, tail = 4): string =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`
