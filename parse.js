// Drop-in parser for markdown-render-speed-02.
// Returns the exact same HTML as marked 18.1.3's marked.parse(markdown) with default options:
// gfm: true, breaks: false, pedantic: false, async: false.
// Reference implementation: vendor/marked/marked.esm.js (MIT, see vendor/marked/LICENSE and NOTICE).

import { marked } from './vendor/marked/marked.esm.js';

// Configure defaults once at module initialization.
marked.setOptions({
  gfm: true,
  breaks: false,
  pedantic: false,
  async: false,
});

/** Render markdown to HTML byte-for-byte identical to marked 18.1.3 defaults. */
export function parse(markdown) {
  return marked.parse(markdown);
}

export default { parse };
