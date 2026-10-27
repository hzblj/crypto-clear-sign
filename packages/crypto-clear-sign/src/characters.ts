/**
 * Characters that make text read differently than it is: controls (but tab and line breaks), direction overrides and
 * isolates (the "RLO" spoof that shows `gpj.exe` as `exe.jpg`), zero-width spaces and joiners that hide inside words,
 * fillers that render as nothing, and tag characters that smuggle invisible ASCII. Zero-width joiners and non-joiners
 * (emoji sequences, Persian, Indic scripts) and emoji variation selectors are ordinary text and pass.
 */
const isHidden = (point: number): boolean =>
  (point <= 0x1f && point !== 0x09 && point !== 0x0a && point !== 0x0d) ||
  (point >= 0x7f && point <= 0x9f) ||
  point === 0xad ||
  point === 0x34f ||
  point === 0x61c ||
  point === 0x115f ||
  point === 0x1160 ||
  point === 0x17b4 ||
  point === 0x17b5 ||
  point === 0x180e ||
  point === 0x200b ||
  point === 0x200e ||
  point === 0x200f ||
  (point >= 0x2028 && point <= 0x202e) ||
  (point >= 0x2060 && point <= 0x206f) ||
  point === 0x3164 ||
  point === 0xfeff ||
  point === 0xffa0 ||
  (point >= 0xfff9 && point <= 0xfffb) ||
  (point >= 0xe0000 && point <= 0xe007f) ||
  (point >= 0xe0100 && point <= 0xe01ef)

/**
 * Whether `text` has characters that hide or reorder what it shows (see above). A chain package raises
 * `HIDDEN_CHARACTERS` on a message, a label or a name that has them; a UI should show them escaped, as `plainText`
 * does, never render them.
 */
export const hasHiddenCharacters = (text: string): boolean => {
  for (const character of text) {
    if (isHidden(character.codePointAt(0) ?? 0)) {
      return true
    }
  }

  return false
}

/** `text` with each hidden character written as `\u{202E}`, so a log or a screen reader shows it. Internal. */
export const escapeHidden = (text: string): string => {
  let escaped = ''

  for (const character of text) {
    const point = character.codePointAt(0) ?? 0
    escaped += isHidden(point) ? `\\u{${point.toString(16).toUpperCase()}}` : character
  }

  return escaped
}
