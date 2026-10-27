import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {hasHiddenCharacters} from '../src'

describe('hasHiddenCharacters', () => {
  test('ordinary text, line breaks, tabs, emoji sequences and other scripts pass', () => {
    for (const text of [
      '',
      'Sign in to example.com',
      'Line one\nLine two\r\nLine three\twith a tab',
      'Příliš žluťoučký kůň úpěl ďábelské ódy',
      'سلام دنیا',
      'می‌خواهم',
      '👩‍👩‍👧 ❤️ 👍🏽',
      'नमस्ते',
    ]) {
      assert.ok(!hasHiddenCharacters(text), text)
    }
  })

  test('controls, direction overrides, zero-width and invisible characters are found', () => {
    for (const [text, what] of [
      ['Send\u0000', 'NUL'],
      ['\u001B[31mred', 'escape'],
      ['\u007F', 'DEL'],
      ['\u0085', 'C1 next line'],
      ['invoice_‮fdp.exe', 'right-to-left override'],
      ['⁦isolate⁩', 'isolates'],
      ['‎alpha‏', 'direction marks'],
      ['؜', 'Arabic letter mark'],
      ['uni​swap', 'zero-width space'],
      ['﻿hello', 'byte order mark'],
      ['soft­hyphen', 'soft hyphen'],
      ['word⁠joiner', 'word joiner'],
      ['line separator', 'line separator'],
      ['ㅤ', 'Hangul filler'],
      ['tag\u{E0041}\u{E0042}', 'tag characters'],
      ['\u{E0100}', 'variation selector supplement'],
    ] as const) {
      assert.ok(hasHiddenCharacters(text), what)
    }
  })
})
