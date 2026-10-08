/**
 * Core line-ending normalisation logic.
 *
 * Design decisions:
 *
 * 1. We treat a CRLF pair as a single logical newline so that input
 *    containing mixed endings is collapsed correctly. A naive
 *    find/replace of LF alone would leave a stray CR behind when the
 *    source contains CRLF and the target is LF; a naive replace of CR
 *    alone would break CRLF pairs. Therefore the pipeline is always:
 *      input -> split on logical newlines -> join with target.
 *
 * 2. The set of recognised newlines is fixed: LF, CRLF, CR. We do not
 *    attempt to detect Unicode line separators (U+2028/U+2029) or
 *    form feeds. Those are vanishingly rare in text files and
 *    treating them would expand the contract beyond what the brief
 *    asks for. If they appear, they pass through unchanged.
 *
 * 3. For streaming, we cannot scan the whole buffer at once because a
 *    CRLF pair may be split across chunks: the CR arrives at the end
 *    of one chunk and the LF at the start of the next. The stream
 *    transformer therefore holds back a trailing CR and inspects the
 *    next chunk before emitting it.
 */

/**
 * The three line-ending formats this library converts between.
 *
 * @typedef {'LF' | 'CRLF' | 'CR'} LineEnding
 */

/**
 * Internal: the byte sequences each format maps to.
 *
 * Kept as a plain object rather than a Map because the keys are static
 * and the object literal is easier to read at the call site.
 *
 * @type {Record<string, string>}
 */
export const ENDINGS = Object.freeze({
  LF: '\n',
  CRLF: '\r\n',
  CR: '\r'
})

/**
 * Validate that a value is one of the supported line-ending names.
 *
 * Throws rather than returning a boolean so that a bad caller fails
 * loudly at the boundary instead of silently producing wrong output.
 *
 * @param {string} name - The candidate ending name.
 * @returns {string} The canonical name, unchanged.
 * @throws {TypeError} If `name` is not 'LF', 'CRLF', or 'CR'.
 */
export function assertEnding(name) {
  if (name !== 'LF' && name !== 'CRLF' && name !== 'CR') {
    throw new TypeError(
      `Unsupported line ending: ${typeof name === 'string' ? name : String(name)} (expected LF, CRLF, or CR)`
    )
  }
  return name
}

/**
 * Normalise line endings in a complete string.
 *
 * All recognised newline sequences (CRLF, LF, CR) in the input are
 * replaced with the single target ending. This means mixed-ending
 * input becomes consistent-ending output.
 *
 * Edge cases handled:
 *   - Empty string returns empty string.
 *   - A lone trailing CR is preserved as a logical newline.
 *   - Newlines adjacent to each other are each converted, so a blank
 *     line (two consecutive newlines) stays a blank line.
 *
 * @param {string} input - The text to normalise.
 * @param {LineEnding} target - The desired ending format.
 * @returns {string} The normalised text.
 * @throws {TypeError} If `target` is not a supported ending name.
 */
export function normalizeString(input, target) {
  assertEnding(target)
  const replacement = ENDINGS[target]

  if (input.length === 0) {
    return ''
  }

  // We build the result in a single pass using a regular expression
  // that matches CRLF first (so the pair is treated atomically), then
  // lone LF, then lone CR. The 'g' flag lets us replace all in one
  // call, which is measurably faster than splitting and joining for
  // large strings on V8.
  //
  // We pre-compile the RegExp once. Because it has no captures, we
  // can use a plain string replacement.
  return input.replace(/\r\n|\r|\n/g, replacement)
}

/**
 * Streaming transformer that converts line endings across chunk
 * boundaries.
 *
 * The transformer accumulates input and emits output chunk by chunk.
 * The only stateful concern is a CRLF pair split across two chunks:
 * if a chunk ends with CR, we hold it back. On the next chunk, we
 * prepend the held CR so that a possible following LF is seen as part
 * of the pair. On flush, a held CR is emitted as a converted newline.
 *
 * `transform(chunk)` returns the string that is safe to emit for the
 * given chunk (may be empty). `flush()` returns any remaining held
 * data and must be called once at end of stream.
 */
export class LineEndingTransformer {
  /**
   * @param {LineEnding} target - The desired line-ending format.
   * @throws {TypeError} If `target` is not a supported ending name.
   */
  constructor(target) {
    assertEnding(target)
    this._target = target
    this._held = ''
  }

  /**
   * Process one chunk of input.
   *
   * If the previous chunk left a trailing CR, we prepend it here so
   * that a CRLF pair split across chunks is correctly detected.
   *
   * If this chunk itself ends with a lone CR, we hold it back for the
   * next call (or flush). Otherwise we convert and return everything
   * we can.
   *
   * @param {string} chunk - A piece of the input stream.
   * @returns {string} The converted output safe to emit now.
   */
  transform(chunk) {
    if (typeof chunk !== 'string') {
      throw new TypeError('LineEndingTransformer.transform expects a string chunk')
    }

    // Combine any held CR from the previous chunk with this one.
    // If the held CR is followed by an LF, the pair will be matched
    // by the regex in the inner normalise call. If not, the held CR
    // is still a logical newline and will be converted.
    const combined = this._held + chunk
    this._held = ''

    if (combined.length === 0) {
      return ''
    }

    // If the combined text ends with a CR, we cannot yet know whether
    // it is a lone CR or the first half of a CRLF pair. Hold it back.
    // The fast path: most chunks will not end in CR, so we only do
    // the substring work when necessary.
    let toConvert = combined
    if (combined.charCodeAt(combined.length - 1) === 0x0d /* CR */) {
      toConvert = combined.slice(0, -1)
      this._held = '\r'
    }

    if (toConvert.length === 0) {
      return ''
    }

    return normalizeString(toConvert, this._target)
  }

  /**
   * Emit any remaining held data at the end of the stream.
   *
   * A held CR at end-of-stream is a complete (lone) newline and must
   * be converted to the target ending. If there is nothing held,
   * returns the empty string.
   *
   * @returns {string} Any final converted output.
   */
  flush() {
    const held = this._held
    this._held = ''
    if (held.length === 0) {
      return ''
    }
    return normalizeString(held, this._target)
  }
}
