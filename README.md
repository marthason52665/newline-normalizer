# Newline Normalizer

Converts line endings between LF, CRLF, and CR formats, either on a complete
string in memory or across a stream of chunks.

## Why

Text files cross platforms and pick up the local convention. Mixing endings
inside a single file breaks diffs, search, and some parsers. This library
gives you one function for the in-memory case and one streaming transformer
for files too large to read whole.

The trade-off: we recognise only the three classic ASCII newlines (LF, CRLF,
CR). Unicode line/paragraph separators (U+2028, U+2029) and form feeds are
left untouched. Handling them would expand the contract for almost no
real-world benefit, and silent passthrough is safer than partial guessing.

## Usage

```js
import { normalizeString, LineEndingTransformer } from './src/index.js'

// In-memory: converts every recognised newline to LF.
const clean = normalizeString('a\r\nb\rc\n', 'LF')
// 'a\nb\nc\n'

// Streaming: feed chunks, get converted chunks back.
const tx = new LineEndingTransformer('CRLF')
let out = ''
out += tx.transform('hello\r')    // 'hello'
out += tx.transform('\nworld')      // '\r\nworld'
out += tx.flush()                   // ''
// out === 'hello\r\nworld'
```

## Edge case to know about

The one awkwardness is a CRLF pair split across chunk boundaries in streaming
mode. If a chunk ends with a bare `\r`, the transformer holds it back until it
sees the next chunk, because it cannot yet know whether a `\n` will follow.
This means `transform(chunk)` may return a shorter string than you fed it.
Always call `flush()` at end of stream; a held trailing `\r` is emitted there
as a converted newline.

A lone trailing `\r` with no following chunk is treated as a complete newline
on flush, which is the only sensible reading: there is no way to distinguish a
lone CR from the first half of a pair that never arrives.

## Exports

- `normalizeString(input, target)` — convert all newlines in a string.
- `LineEndingTransformer` — streaming transformer; call `transform(chunk)`
  per chunk and `flush()` once at the end.
- `ENDINGS` — frozen map of `{ LF, CRLF, CR }` to their byte sequences.
- `assertEnding(name)` — throws `TypeError` unless `name` is a supported
  ending; returns the canonical name otherwise.

`target` is one of the string literals `'LF'`, `'CRLF'`, or `'CR'`.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

