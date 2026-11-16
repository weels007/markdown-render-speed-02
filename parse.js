// parse.js — a fast, dependency-free drop-in for marked v18.1.3's parse() with
// marked's default options (gfm true; breaks, pedantic, async off).
//
// This is a fork of marked v18.1.3 (MIT), rewritten for speed. The licence and
// notice of the upstream project are vendored beside it: vendor/marked/LICENSE
// and vendor/marked/NOTICE. The block/inline rules, tokenizers, lexer, parser
// and renderers follow marked's implementation (github.com/markedjs/marked,
// tag v18.1.3, commit ba50aa9) with its default-options code paths only, plus
// local, behavior-preserving optimizations: first-character dispatch before
// anchored regexes, manual scans in place of small regexes, and fewer
// allocations. Nothing is cached between parse() calls: every call builds its
// own lexer state.
//
// Semantics to keep byte-identical: marked.parse(markdown) with the defaults,
// for every string input. Errors match marked's too (non-string input,
// infinite-loop guard).

const noopTest = { exec: () => null };

// --------------------------------------------------------------------------
// marked's regex builder (edit), used to compose the rule sources exactly as
// marked's rules.ts does
// --------------------------------------------------------------------------

const caret = /(^|[^\[])\^/g;

function edit(regex, opt = '') {
  let source = typeof regex === 'string' ? regex : regex.source;
  const obj = {
    replace(name, val) {
      let valSource = typeof val === 'string' ? val : val.source;
      valSource = valSource.replace(caret, '$1');
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex: () => new RegExp(source, opt),
  };
  return obj;
}

// use a default variable so the regex is evaluated at load, not removed by minifiers
const supportsLookbehind = /* @__PURE__ */ ((a = '') => {
  try {
    return !!new RegExp('(?<=1)(?<!1)' + a);
  } catch {
    return false;
  }
})();

// --------------------------------------------------------------------------
// other (shared) rules — subset used by the default-options paths
// --------------------------------------------------------------------------

const codeRemoveIndent = /^(?: {0,3}\t| {1,4})/gm;
const outputLinkReplace = /\\([\[\]])/g;
const indentCodeCompensation = /^(\s+)(?:```)/;
const beginningSpace = /^\s+/;
const endingHash = /#$/;
const endingSpaceTabChar = /[ \t]$/;
const nonSpaceChar = /[^ ]/;
const newLineCharGlobal = /\n/g;
const tabCharGlobal = /\t/g;
const leadingSpaceTab = /^[ \t]+/;
const multipleSpaceGlobal = /\s+/g;
const blankLine = /^[ \t]*$/;
const doubleBlankLine = /\n[ \t]*\n[ \t]*$/;
const blockquoteSetextReplace = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const blockquoteMarkerWhitespace = /^( {0,3}>)([ \t]+)/gm;
const listReplaceNesting = /^ {1,4}(?=( {4})*[^ ])/g;
const listIsTask = /^\[[ xX]\][ \t]+\S/;
const listReplaceTask = /^\[[ xX]\][ \t]+/;
const listTaskCheckbox = /\[[ xX]\]/;
const anyLine = /\n.*\n/;
const hrefBrackets = /^<(.*)>$/;
const tableAlignChars = /^\||\| *$/g;
const tableRowBlankLine = /\n[ \t]*$/;
const tableAlignRight = /^ *-+: *$/;
const tableAlignCenter = /^ *:-+: *$/;
const tableAlignLeft = /^ *:-+ *$/;
const unicodeAlphaNumeric = /[\p{L}\p{N}]/u;
const numericCharacterReference = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const numericCharacterReferenceOrAmpersand = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const escapeTest = /[&<>"']/;
const escapeReplace = /[&<>"']/g;
const escapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const escapeReplaceNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const percentDecode = /%25/g;
const findPipe = /\|/g;
const splitPipe = / \|/;
const slashPipe = /\\\|/g;
const carriageReturn = /\r\n|\r/g;
const notSpaceStart = /^\S*/;
const endingNewline = /\n$/;

function cachedIndentRegex(createRegex) {
  const cache = [];
  return (indent) => {
    const cacheIndex = Math.max(0, Math.min(3, indent - 1));
    let regex = cache[cacheIndex];
    if (!regex) {
      regex = createRegex(cacheIndex);
      cache[cacheIndex] = regex;
    }
    return regex;
  };
}

const listItemRegex = (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`);
const nextBulletRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`));
const hrRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const fencesBeginRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:\`\`\`|~~~)`));
const headingBeginRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}#{1,6}(?:\\s|$)`));
const htmlBeginRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:</?(?:${_tag})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const blockquoteBeginRegex = cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}>`));

// --------------------------------------------------------------------------
// block rules (gfm = marked's defaults: blockGfm)
// --------------------------------------------------------------------------

const newline = /^(?:[ \t]*(?:\n|$))+/;
const blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const bullet = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
// The underline may end with spaces or tabs (CommonMark §4.3). Internal
// spaces or tabs still fail to match, and more than three spaces of indent
// still do not.
const lheadingCore = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const lheadingGfm = edit(lheadingCore)
  .replace(/bull/g, bullet) // lists can interrupt
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/) // indented code can start a block but cannot interrupt a paragraph
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/) // fenced code blocks can interrupt
  .replace(/blockquote/g, / {0,3}>/) // blockquote can interrupt
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/) // ATX heading can interrupt
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/) // thematic break can interrupt
  .replace(/html/g, / {0,3}<[^\n>]+>\n/) // block html can interrupt
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/) // table can interrupt
  .getRegex();
const _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const blockText = /^[^\n]+/;
const _blockLabel = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', _blockLabel)
  // An escaped delimiter is part of the title, so a backslash must consume the
  // next character. An optional closer (`\"?`) lets that character backtrack
  // into the closing quote (`[foo]: /url "t\"` is not a title).
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .getRegex();

const list = edit(/^(bull)([ \t][^\n]*?)?(?:\n|$)/)
  .replace(/bull/g, bullet)
  .getRegex();

const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const html = edit(
  '^ {0,3}(?:' // optional indentation
+ '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)' // (1)
+ '|comment[^\\n]*(\\n+|$)' // (2)
+ '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)' // (3)
+ '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)' // (4)
+ '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)' // (5)
+ '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (6)
+ '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) open tag
+ '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) closing tag
+ ')', 'i')
  .replace('comment', _comment)
  .replace('tag', _tag)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .getRegex();

const createParagraph = (listInterrupt) => edit(_paragraph)
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
  .replace('|table', '')
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', listInterrupt)
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag) // pars can be interrupted by html blocks of types (1) to (6)
  .getRegex();

// inside a blockquote a bare list marker (any number) starts a sibling list,
// so it must not be lazily continued as paragraph text (unlike a top level
// paragraph, where an empty list cannot interrupt)
const blockquoteParagraph = createParagraph(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);

// a line with only whitespace after the marker is blank, so it must not start a
// paragraph that lazily continues onto the next line
const blockquote = edit(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/)
  .replace('paragraph', blockquoteParagraph)
  .getRegex();

// GFM table
const gfmTable = edit(
  '^ *([^\\n ].*)\\n' // Header
+ ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)' // Align
+ '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)') // Cells
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]') // any bullet ends the table rows
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag) // tables can be interrupted by html blocks of types (1) to (6)
  .getRegex();

// blockGfm.paragraph: like the commonmark paragraph but tables interrupt too
const paragraph = edit(_paragraph)
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '') // setext headings don't interrupt commonmark paragraphs
  .replace('table', gfmTable) // interrupt paragraphs with table
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]') // only non-empty lists starting from 1 can interrupt
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag) // pars can be interrupted by html blocks of types (1) to (6)
  .getRegex();
