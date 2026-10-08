/**
 * Public entry point for the newline-normalizer library.
 *
 * Re-exports the string API and the streaming transformer so callers
 * can import everything from a single path:
 *
 *   import { normalizeString, LineEndingTransformer, ENDINGS } from './src/index.js'
 */

export { normalizeString, LineEndingTransformer, ENDINGS, assertEnding } from './core.js'
