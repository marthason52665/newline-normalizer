import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeString,
  LineEndingTransformer,
  ENDINGS,
  assertEnding
} from '../src/index.js'

// --- normalizeString: happy path -----------------------------------------

test('normalizes mixed endings to LF', () => {
  const input = 'line1\r\nline2\nline3\rline4'
  const out = normalizeString(input, 'LF')
  assert.equal(out, 'line1\nline2\nline3\nline4')
})

test('normalizes mixed endings to CRLF', () => {
  const input = 'a\nb\r\nc\rd'
  const out = normalizeString(input, 'CRLF')
  assert.equal(out, 'a\r\nb\r\nc\r\nd')
})

test('normalizes mixed endings to CR', () => {
  const input = 'a\nb\r\nc\rd'
  const out = normalizeString(input, 'CR')
  assert.equal(out, 'a\rb\rc\rd')
})

test('idempotent when already LF', () => {
  const input = 'a\nb\nc\n'
  assert.equal(normalizeString(input, 'LF'), input)
})

test('idempotent when already CRLF', () => {
  const input = 'a\r\nb\r\n'
  assert.equal(normalizeString(input, 'CRLF'), input)
})

// --- normalizeString: edge cases ----------------------------------------

test('empty string returns empty string', () => {
  assert.equal(normalizeString('', 'LF'), '')
  assert.equal(normalizeString('', 'CRLF'), '')
  assert.equal(normalizeString('', 'CR'), '')
})

test('blank lines preserved when targeting LF', () => {
  // Two consecutive CRLF pairs should become two LFs, keeping the
  // blank line.
  const input = 'a\r\n\r\nb'
  assert.equal(normalizeString(input, 'LF'), 'a\n\nb')
})

test('trailing lone CR converted to LF', () => {
  const input = 'abc\r'
  assert.equal(normalizeString(input, 'LF'), 'abc\n')
})

test('string with no newlines is returned unchanged', () => {
  assert.equal(normalizeString('hello world', 'LF'), 'hello world')
})

test('CRLF pair is treated as one logical newline, not two', () => {
  // If we naively replaced LF first, CRLF -> CRLF+LF would be wrong.
  const input = 'x\r\ny'
  assert.equal(normalizeString(input, 'LF'), 'x\ny')
  assert.equal(normalizeString(input, 'CR'), 'x\ry')
})

// --- assertEnding -------------------------------------------------------

test('assertEnding returns canonical name for valid input', () => {
  assert.equal(assertEnding('LF'), 'LF')
  assert.equal(assertEnding('CRLF'), 'CRLF')
  assert.equal(assertEnding('CR'), 'CR')
})

test('assertEnding throws for unsupported name', () => {
  assert.throws(() => assertEnding('WAT'), TypeError)
})

test('normalizeString throws TypeError for bad target', () => {
  assert.throws(() => normalizeString('a\nb', 'NL'), TypeError)
})

// --- ENDINGS constant ---------------------------------------------------

test('ENDINGS maps names to expected byte sequences', () => {
  assert.deepEqual(ENDINGS, { LF: '\n', CRLF: '\r\n', CR: '\r' })
})

test('ENDINGS is frozen', () => {
  assert.equal(Object.isFrozen(ENDINGS), true)
})

// --- LineEndingTransformer: streaming ----------------------------------

test('streaming produces same result as one-shot for mixed input', () => {
  const input = 'line1\r\nline2\nline3\rline4\r\n'
  const t = new LineEndingTransformer('LF')

  // Feed in arbitrary chunk boundaries.
  let out = ''
  out += t.transform('line1\r')
  out += t.transform('\nline2')
  out += t.transform('\nline3\r')
  out += t.transform('line4')
  out += t.transform('\r\n')
  out += t.flush()

  assert.equal(out, normalizeString(input, 'LF'))
})

test('streaming handles CRLF split exactly at chunk boundary', () => {
  // The CR is at the end of chunk 1, the LF at the start of chunk 2.
  // This must become a single LF in the output, not LF+LF.
  const t = new LineEndingTransformer('LF')
  const out = t.transform('a\r') + t.transform('\nb') + t.flush()
  assert.equal(out, 'a\nb')
})

test('streaming emits held trailing CR as newline on flush', () => {
  // Chunk ends with a lone CR; with no following chunk we cannot tell
  // if an LF was coming. On flush, the held CR must be converted.
  const t = new LineEndingTransformer('CRLF')
  const out = t.transform('abc\r') + t.flush()
  assert.equal(out, 'abc\r\n')
})

test('streaming with no trailing CR flushes empty', () => {
  const t = new LineEndingTransformer('LF')
  const out = t.transform('hello') + t.flush()
  assert.equal(out, 'hello')
})

test('streaming empty chunks throughout yields empty output', () => {
  const t = new LineEndingTransformer('LF')
  const out = t.transform('') + t.transform('') + t.flush()
  assert.equal(out, '')
})

test('streaming trailing CR then empty chunk then flush', () => {
  // After a held CR, an empty chunk must not lose the held CR.
  const t = new LineEndingTransformer('LF')
  const out = t.transform('a\r') + t.transform('') + t.flush()
  assert.equal(out, 'a\n')
})

test('streaming constructor rejects unsupported target', () => {
  assert.throws(() => new LineEndingTransformer('XX'), TypeError)
})

test('streaming transform rejects non-string chunk', () => {
  const t = new LineEndingTransformer('LF')
  assert.throws(() => t.transform(42), TypeError)
})

test('streaming multiple CRLF pairs split at boundaries', () => {
  const t = new LineEndingTransformer('LF')
  let out = ''
  out += t.transform('a\r')
  out += t.transform('\n\r')
  out += t.transform('\nb')
  out += t.flush()
  // Two logical newlines between a and b -> one blank line.
  assert.equal(out, 'a\n\nb')
})
