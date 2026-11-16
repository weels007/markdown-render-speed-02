// Drop-in markdown → HTML parser, byte-for-byte identical to marked 18.1.3's
// marked.parse(markdown) with default options (gfm: true, breaks: false,
// pedantic: false, async: false). Dependency-free port of the marked sources
// (MIT, see vendor/marked/LICENSE and NOTICE), specialized to those defaults.

// ---------------------------------------------------------------------------
// Rule construction (rules.ts, gfm set only)
// ---------------------------------------------------------------------------

const supportsLookbehind = ((a = '') => {
  try {
    return !!new RegExp('(?<=1)(?<!1)' + a);
  } catch {
    // See browser support here:
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion
    return false;
  }
})();

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

const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;

const other = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  // Neutralize a lazy setext underline, including one with trailing tabs.
  // CommonMark §4.3 allows those tabs on a real underline, so the same class
  // has to be recognized here or a lazy `===\t` becomes a heading.
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
  numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  escapeTest: /[&<>"']/,
  escapeReplace: /[&<>"']/g,
  escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
  escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  caret: /(^|[^\[])\^/g,
  percentDecode: /%25/g,
  findPipe: /\|/g,
  splitPipe: / \|/,
  slashPipe: /\\\|/g,
  carriageReturn: /\r\n|\r/g,
  spaceLine: /^ +$/gm,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`),
  nextBulletRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`)),
  hrRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`)),
  fencesBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:\`\`\`|~~~)`)),
  // an ATX heading needs a space (or the end of the line) after the hashes, so a line
  // like `#tag` does not end a list item; pedantic mode accepts it as a heading
  headingBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}#{1,6}(?:\\s|$)`)),
  // a list item ends where a paragraph would be interrupted, so this mirrors the
  // html start conditions in the paragraph rule below; type 7 is excluded there
  htmlBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:</?(?:${_tag})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}>`)),
};

function edit(regex, opt = '') {
  let source = typeof regex === 'string' ? regex : regex.source;
  const obj = {
    replace(name, val) {
      let valSource = typeof val === 'string' ? val : val.source;
      valSource = valSource.replace(other.caret, '$1');
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex: () => {
      return new RegExp(source, opt);
    },
  };
  return obj;
}

/**
 * Block-Level Grammar
 */

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

const html = edit(
  '^ {0,3}(?:' // optional indentation
+ '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)' // (1)
+ '|comment[^\\n]*(\\n+|$)' // (2)
+ '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)' // (3)
+ '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)' // (4)
+ '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)' // (5)
+ '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (6)
+ '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)' // (7) open tag
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

const gfmParagraph = edit(_paragraph)
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

/**
 * Inline-Level Grammar
 */

const escape = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const br = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;

// list of unicode punctuation marks, plus any missing characters from CommonMark spec
const _punctuation = /[\p{P}\p{S}]/u;
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
const punctuation = edit(/^((?![*_])punctSpace)/, 'u')
  .replace(/punctSpace/g, _punctuationOrSpace).getRegex();

// GFM allows ~ inside strong and em for strikethrough
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;

// sequences em should skip over [title](link), `code`, <html>
const blockSkip = edit(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', supportsLookbehind ? '(?<!`)()' : '(^^|[^`])')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .getRegex();

const emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;

const emStrongLDelim = edit(emStrongLDelimCore, 'u')
  .replace(/punct/g, _punctuationGfmStrongEm)
  .getRegex();

const emStrongRDelimAstCore =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
+ '|[^*]+(?=[^*])' // Consume to delim
+ '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) #*** can only be a Right Delimiter
+ '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) a***#, a*** can only be a Right Delimiter
+ '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) #***a, ***a can only be a Left Delimiter
+ '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) ***# can only be a Left Delimiter
+ '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) #***# can be either Left or Right Delimiter
+ '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) a***a can be either Left or Right Delimiter

const emStrongRDelimAst = edit(emStrongRDelimAstCore, 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm)
  .replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm)
  .replace(/punct/g, _punctuationGfmStrongEm)
  .getRegex();

// Normal: no rule 6 for _ (a___a cannot close as emphasis).
const emStrongRDelimUndCore =
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // Skip orphan inside strong
+ '|[^_]+(?=[^_])' // Consume to delim
+ '|(?!_)punct(_+)(?=[\\s]|$)' // (1) #___ can only be a Right Delimiter
+ '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) a___#, a___ can only be a Right Delimiter
+ '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) #___a, ___a can only be a Left Delimiter
+ '|[\\s](_+)(?!_)(?=punct)' // (4) ___# can only be a Left Delimiter
+ '|(?!_)punct(_+)(?!_)(?=punct)'; // (5) #___# can be either Left or Right Delimiter

const emStrongRDelimUnd = edit(emStrongRDelimUndCore, 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpace)
  .replace(/punctSpace/g, _punctuationOrSpace)
  .replace(/punct/g, _punctuation)
  .getRegex();

// Tilde left delimiter for strikethrough (similar to emStrongLDelim for asterisk)
const delLDelim = edit(/^~~?(?:((?!~)punct)|[^\s~])/, 'u')
  .replace(/punct/g, _punctuation)
  .getRegex();

// Tilde delimiter patterns for strikethrough (similar to asterisk)
const delRDelimCore =
  '^[^~]+(?=[^~])' // Consume to delim
+ '|(?!~)punct(~~?)(?=[\\s]|$)' // (1) #~~ can only be a Right Delimiter
+ '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)' // (2) a~~#, a~~ can only be a Right Delimiter
+ '|(?!~)punctSpace(~~?)(?=notPunctSpace)' // (3) #~~a, ~~a can only be a Left Delimiter
+ '|[\\s](~~?)(?!~)(?=punct)' // (4) ~~# can only be a Left Delimiter
+ '|(?!~)punct(~~?)(?!~)(?=punct)' // (5) #~~# can be either Left or Right Delimiter
+ '|notPunctSpace(~~?)(?=notPunctSpace)'; // (6) a~~a can be either Left or Right Delimiter

const delRDelim = edit(delRDelimCore, 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpace)
  .replace(/punctSpace/g, _punctuationOrSpace)
  .replace(/punct/g, _punctuation)
  .getRegex();

const anyPunctuation = edit(/\\(punct)/, 'gu')
  .replace(/punct/g, _punctuation)
  .getRegex();

// `anyPunctuation` for the em/strong mask. A backslash is literal inside a code
// span, so a code span (matched like `inline.code`), or a backtick run that
// opens none, is matched whole and kept; only the escapes outside code spans
// are masked.
const anyPunctuationOutsideCode = edit(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu')
  .replace(/punct/g, _punctuation)
  .getRegex();

const autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
  .getRegex();

const _inlineComment = edit(_comment).replace('(?:-->|$)', '-->').getRegex();
const inlineTag = edit(
  '^comment'
    + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>' // self-closing tag
    + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>' // open tag
    + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>') // CDATA section
  .replace('comment', _inlineComment)
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .getRegex();

// One matched pair of brackets, holding no bracket of its own.
const _inlineLabelBrackets = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
// CommonMark lets the brackets in a link label nest to any depth, which a regex
// cannot follow, so it stops at a fixed one. Two levels is what the spec suite
// asks for: a third and a fourth flip no further example.
const _inlineLabel = edit(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/)
  .replace('brackets', _inlineLabelBrackets)
  .getRegex();

const link = edit(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', _inlineLabel)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  // Same as the definition title: the escaped character is not the closer.
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .getRegex();

const reflink = edit(/^!?\[(label)\]\[(ref)\]/)
  .replace('label', _inlineLabel)
  .replace('ref', _blockLabel)
  .getRegex();

const nolink = edit(/^!?\[(ref)\](?:\[\])?/)
  .replace('ref', _blockLabel)
  .getRegex();

// `reflink` and `nolink` are anchored, so the tokenizer tries each of them at a
// single position. `reflinkSearch` drops the anchors and runs with the global
// flag, which makes every '[' in the source a start position. A label crosses a
// bracket only by escaping it, and nothing caps how often it does, so a
// candidate that can never match still scans to the end of the source and the
// whole pass costs O(n^2).
//
// The labels below bound that scan. `_boundedInlineLabel` limits how many
// escapes, code spans and nested brackets a link text may hold, leaving runs of
// ordinary characters unbounded so link text of any length is still found.
// `_boundedBlockLabel` limits the label itself to 999 items, which is every
// label CommonMark allows: "A link label can have at most 999 characters
// inside the square brackets."
const _boundedBlockLabel = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const _boundedInlineLabel = edit(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/)
  .replace('brackets', _inlineLabelBrackets)
  .getRegex();

const reflinkSearch = edit('reflink|nolink(?!\\()', 'g')
  .replace('reflink', edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', _boundedInlineLabel)
    .replace('ref', _boundedBlockLabel)
    .getRegex())
  .replace('nolink', edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', _boundedBlockLabel)
    .getRegex())
  .getRegex();

const _caseInsensitiveProtocol = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const _extendedEmail = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const _extendedEmailProtocol = edit(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/)
  .replace(/email/g, _extendedEmail)
  .getRegex();

const url = edit(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', _extendedEmailProtocol)
  .replace('protocol', _caseInsensitiveProtocol)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/)
  .getRegex();

// GFM: a www autolink starts only at the beginning of a line, after whitespace or after
// `*`, `_`, `~` or `(`. Without lookbehind support, keep stopping at every `www.`.
const gfmText = edit(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', _caseInsensitiveProtocol)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', supportsLookbehind ? '(?<![^\\s*_~(])www\\.' : 'www\\.')
  .getRegex();

const _backpedal = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

const block = {
  blockquote,
  code: blockCode,
  def,
  fences,
  heading,
  hr,
  html,
  lheading: lheadingGfm,
  list,
  newline,
  paragraph: gfmParagraph,
  table: gfmTable,
  text: blockText,
};

const inline = {
  _backpedal,
  anyPunctuation,
  anyPunctuationOutsideCode,
  autolink,
  blockSkip,
  br,
  code: inlineCode,
  delLDelim,
  delRDelim,
  emStrongLDelim,
  emStrongRDelimAst,
  emStrongRDelimUnd,
  escape,
  link,
  nolink,
  punctuation,
  reflink,
  reflinkSearch,
  tag: inlineTag,
  text: gfmText,
  url,
};

// ---------------------------------------------------------------------------
// Helpers (helpers.ts)
// ---------------------------------------------------------------------------

const escapeReplacements = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtmlEntities(html, encode) {
  if (encode) {
    if (other.escapeTest.test(html)) {
      return html.replace(other.escapeReplace, escapeHtmlGetReplacement);
    }
  } else {
    if (other.escapeTestNoEncode.test(html)) {
      return html.replace(other.escapeReplaceNoEncode, escapeHtmlGetReplacement);
    }
  }
  return html;
}
function escapeHtmlGetReplacement(ch) {
  return escapeReplacements[ch];
}

/**
 * Numeric character references are recognized outside code and are equivalent to the
 * character they name. Values that are zero, out of range, or a surrogate become the
 * replacement character.
 */
function decodeNumericCharacterReferences(text) {
  if (!other.numericCharacterReference.test(text)) {
    return text;
  }
  // A decoded character must not join its neighbours into a new reference,
  // so every `&` that is not already one is escaped here.
  return text.replace(other.numericCharacterReferenceOrAmpersand, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) {
      return '&amp;';
    }
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return '\uFFFD';
    }
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(other.percentDecode, '%');
  } catch {
    return null;
  }
  return href;
}

function splitCells(tableRow, count) {
  // ensure that every cell-delimiting pipe has a space
  // before it to distinguish it from an escaped pipe
  const row = tableRow.replace(other.findPipe, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === '\\') escaped = !escaped;
    if (escaped) {
      // odd number of slashes means | is escaped
      // so we leave it alone
      return '|';
    } else {
      // add space before unescaped |
      return ' |';
    }
  });
  const cells = row.split(other.splitPipe);

  // First/last cell in a row cannot be empty if it has no leading/trailing pipe
  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells[cells.length - 1].trim()) {
    cells.pop();
  }

  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push('');
    }
  }

  for (let i = 0; i < cells.length; i++) {
    // leading or trailing whitespace is ignored per the gfm spec
    cells[i] = cells[i].trim().replace(other.slashPipe, '|');
  }
  return cells;
}

/**
 * Remove trailing 'c's. Equivalent to str.replace(/c*$/, '').
 * /c*$/ is vulnerable to REDOS.
 */
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return '';
  }

  // Length of suffix matching the invert condition.
  let suffLen = 0;

  // Step left until we fail to match the invert condition.
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }

  return str.slice(0, l - suffLen);
}

function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && other.blankLine.test(lines[end])) {
    end--;
  }
  if (lines.length - end <= 2) {
    // we want to keep single trailing blank lines
    return str;
  }

  return lines.slice(0, end + 1).join('\n');
}

/**
 * Normalizes a link label so definitions and references can be matched.
 * CommonMark asks for a Unicode case fold, which `toLowerCase()` does not
 * reach: `ẞ` lowercases to `ß` and so never meets `SS`. Round-tripping
 * through upper case does, as in commonmark.js; the final `toLowerCase()`
 * keeps the folded label lower case, the form `def.tag` has always used.
 */
function normalizeLabel(label) {
  return label.trim().replace(other.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function findClosingBracket(str, b) {
  // an opening bracket on its own is still unbalanced, so both have to be absent
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) {
    return -1;
  }

  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  if (level > 0) {
    return -2;
  }

  return -1;
}

/**
 * Last indexes of `*` / `_` runs that can close emphasis or strong, and of
 * a `~` run that can close strikethrough.
 *
 * A run can close only when it is not preceded by ASCII whitespace or the
 * start of the string. The right-delim regexes accept a closer only in
 * groups 1, 2, 5, and 6, and each of those requires that predecessor. When
 * the opener's window has no such run, the regex scan cannot succeed.
 */
function scanLastPossibleEmStrongDelClosers(src) {
  const lastPossibleEmStrongCloserIndex = { '*': -1, _: -1 };
  let lastPossibleDelCloserIndex = -1;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') {
      continue;
    }
    // A leading run has no predecessor, same as one after a line break.
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < len && src[j] === ch) {
      j++;
    }
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') {
        lastPossibleDelCloserIndex = i;
      } else {
        lastPossibleEmStrongCloserIndex[ch] = i;
      }
    }
    i = j - 1;
  }
  return {
    maskedSrc: src,
    lastPossibleEmStrongCloserIndex,
    lastPossibleDelCloserIndex,
  };
}

function cachedLastPossibleEmStrongCloserIndex(lx, maskedSrc, delim) {
  const frame = lx.hints[lx.hints.length - 1];
  if (frame && frame.maskedSrc === maskedSrc) {
    return frame.lastPossibleEmStrongCloserIndex[delim];
  }
  return scanLastPossibleEmStrongDelClosers(maskedSrc).lastPossibleEmStrongCloserIndex[delim];
}

function cachedLastPossibleDelCloserIndex(lx, maskedSrc) {
  const frame = lx.hints[lx.hints.length - 1];
  if (frame && frame.maskedSrc === maskedSrc) {
    return frame.lastPossibleDelCloserIndex;
  }
  return scanLastPossibleEmStrongDelClosers(maskedSrc).lastPossibleDelCloserIndex;
}

function expandTabs(line, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }

  return expanded;
}

// ---------------------------------------------------------------------------
// Block tokenizers (Tokenizer.ts)
// ---------------------------------------------------------------------------

function spaceToken(lx, src) {
  const cap = block.newline.exec(src);
  if (cap && cap[0].length > 0) {
    return {
      type: 'space',
      raw: cap[0],
    };
  }
}

function codeToken(lx, src) {
  const cap = block.code.exec(src);
  if (cap) {
    const raw = trimTrailingBlankLines(cap[0]);
    const text = raw.replace(other.codeRemoveIndent, '');
    return {
      type: 'code',
      raw,
      codeBlockStyle: 'indented',
      text,
    };
  }
}

function indentCodeCompensation(raw, text) {
  const matchIndentToCode = raw.match(other.indentCodeCompensation);

  if (matchIndentToCode === null) {
    return text;
  }

  const indentToCode = matchIndentToCode[1];

  return text
    .split('\n')
    .map(node => {
      const matchIndentInNode = node.match(other.beginningSpace);
      if (matchIndentInNode === null) {
        return node;
      }

      const indentInNode = matchIndentInNode[0];

      // Up to the fence's own indentation is removed from each line, so a line
      // indented less than the fence loses whatever indentation it has.
      return node.slice(Math.min(indentInNode.length, indentToCode.length));
    })
    .join('\n');
}

function fencesToken(lx, src) {
  const cap = block.fences.exec(src);
  if (cap) {
    const raw = cap[0];
    const text = indentCodeCompensation(raw, cap[3] || '');

    return {
      type: 'code',
      raw,
      lang: cap[2] ? cap[2].trim().replace(inline.anyPunctuation, '$1') : cap[2],
      text,
    };
  }
}

function headingToken(lx, src) {
  const cap = block.heading.exec(src);
  if (cap) {
    let text = cap[2].trim();

    // remove trailing #s
    if (other.endingHash.test(text)) {
      const trimmed = rtrim(text, '#');
      if (!trimmed || other.endingSpaceTabChar.test(trimmed)) {
        // CommonMark requires a space or tab before trailing #s
        text = trimmed.trim();
      }
    }

    return {
      type: 'heading',
      raw: rtrim(cap[0], '\n'),
      depth: cap[1].length,
      text,
      tokens: inlineQueuePush(lx, text),
    };
  }
}

function hrToken(lx, src) {
  const cap = block.hr.exec(src);
  if (cap) {
    return {
      type: 'hr',
      raw: rtrim(cap[0], '\n'),
    };
  }
}

function blockquoteToken(lx, src) {
  const cap = block.blockquote.exec(src);
  if (cap) {
    let lines = rtrim(cap[0], '\n').split('\n');
    let raw = '';
    let text = '';
    const tokens = [];

    while (lines.length > 0) {
      let inBlockquote = false;
      const currentLines = [];

      let i;
      for (i = 0; i < lines.length; i++) {
        // get lines up to a continuation
        if (other.blockquoteStart.test(lines[i])) {
          currentLines.push(lines[i]);
          inBlockquote = true;
        } else if (!inBlockquote) {
          currentLines.push(lines[i]);
        } else {
          break;
        }
      }
      lines = lines.slice(i);

      const currentRaw = currentLines.join('\n');
      const currentText = currentRaw
        // a tab after the block quote marker runs to the next tab stop, and
        // the marker only consumes one space of it; the rest is content
        .replace(
          other.blockquoteMarkerWhitespace,
          (_, marker, whitespace) => marker + expandTabs(whitespace, marker.length),
        )
        // precede setext continuation with 4 spaces so it isn't a setext
        .replace(other.blockquoteSetextReplace, '\n    $1')
        .replace(other.blockquoteSetextReplace2, '');
      raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
      text = text ? `${text}\n${currentText}` : currentText;

      // parse blockquote lines as top level tokens
      // merge paragraphs if this is a continuation
      const top = lx.top;
      lx.top = true;
      blockTokens(lx, currentText, tokens, true);
      lx.top = top;

      // if there is no continuation then we are done
      if (lines.length === 0) {
        break;
      }

      const lastToken = tokens[tokens.length - 1];

      if (lastToken && (lastToken.type === 'code' || lastToken.type === 'heading' || lastToken.type === 'hr' || lastToken.type === 'html' || lastToken.type === 'table')) {
        // blockquote continuation cannot be preceded by a code block, heading, hr, html block or table
        break;
      } else if (lastToken && lastToken.type === 'blockquote') {
        // include continuation in nested blockquote
        const oldToken = lastToken;
        // The continuation lines belong to the same nesting frame as the
        // nested blockquote, which already had one '>' marker stripped, so
        // strip one marker from them too. Otherwise a restated marker after a
        // lazy line is re-parsed as a spurious deeper blockquote.
        const continuation = lines.join('\n');
        const newText = oldToken.raw + '\n' + continuation.replace(other.blockquoteSetextReplace2, '');
        const newToken = blockquoteToken(lx, newText);
        tokens[tokens.length - 1] = newToken;

        // Only include continuation lines the nested blockquote actually
        // consumed. Unconsumed trailing lines must stay out of `raw` so the
        // lexer can still tokenize them (paragraph, next blockquote, etc.).
        const leftover = newText.substring(newToken.raw.length).replace(/^\n/, '');
        const leftoverCount = leftover ? leftover.split('\n').length : 0;
        const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
        if (consumed.length > 0) {
          raw = `${raw}\n${consumed.join('\n')}`;
        }
        text = text.substring(0, text.length - oldToken.text.length) + newToken.text;

        // A leftover line that starts with '>' still belongs to this
        // blockquote; any other leftover line ends it.
        lines = lines.slice(consumed.length);
        if (lines.length > 0 && other.blockquoteStart.test(lines[0])) {
          continue;
        }
        break;
      } else if (lastToken && lastToken.type === 'list') {
        // include continuation in nested list
        const oldToken = lastToken;
        const newText = oldToken.raw + '\n' + lines.join('\n');
        const newToken = listToken(lx, newText);
        tokens[tokens.length - 1] = newToken;

        // The list raw has no '>' markers, so it cannot be cut out of `raw`.
        // Count the continuation lines the list took and add those lines instead.
        const consumedCount = newToken.raw.length > oldToken.raw.length
          ? newText.slice(oldToken.raw.length + 1, newToken.raw.length).split('\n').length
          : 0;
        if (consumedCount > 0) {
          const consumed = lines.slice(0, consumedCount).join('\n');
          raw = `${raw}\n${consumed}`;
          text = `${text}\n${consumed}`;
        }
        lines = lines.slice(consumedCount);
        continue;
      }
    }

    return {
      type: 'blockquote',
      raw,
      tokens,
      text,
    };
  }
}

function listToken(lx, src) {
  let cap = block.list.exec(src);
  if (cap) {
    // src is only consumed from the front, so every raw below is a slice of
    // listSrc rather than a string built up line by line
    const listSrc = src;
    const taken = () => listSrc.length - src.length;
    let bull = cap[1].trim();
    const isordered = bull.length > 1;

    const list = {
      type: 'list',
      raw: '',
      ordered: isordered,
      start: isordered ? +bull.slice(0, -1) : '',
      loose: false,
      items: [],
    };

    bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;

    // Get next list item
    const itemRegex = other.listItemRegex(bull);
    let endsWithBlankLine = false;
    // Check if current bullet point can start a new List Item
    while (src) {
      let endEarly = false;
      let itemContents = '';
      if (!(cap = itemRegex.exec(src))) {
        break;
      }

      if (block.hr.test(src)) { // End list if bullet was actually HR (possibly move into itemRegex?)
        break;
      }

      const itemStart = taken();
      src = src.substring(cap[0].length);

      const firstLine = cap[2].split('\n', 1)[0];
      const bulletIndent = cap[1].length;
      let line = firstLine.replace(other.leadingSpaceTab, whitespace => expandTabs(whitespace, bulletIndent));
      let nextLine = src.split('\n', 1)[0];
      let blankLine = !line.trim();

      let indent = 0;
      if (blankLine) {
        indent = bulletIndent + 1;
      } else {
        indent = line.search(other.nonSpaceChar); // Find first non-space char
        indent = indent > 4 ? 1 : indent; // Treat indented code blocks (> 4 spaces) as having only 1 indent
        itemContents = line.slice(indent);
        indent += bulletIndent;
      }

      if (blankLine && other.blankLine.test(nextLine)) { // Items begin with at most one blank line
        src = src.substring(nextLine.length + 1);
        endEarly = true;
      }

      if (!endEarly) {
        const nextBulletRegex = other.nextBulletRegex(indent);
        const hrRegex = other.hrRegex(indent);
        const fencesBeginRegex = other.fencesBeginRegex(indent);
        const headingBeginRegex = other.headingBeginRegex(indent);
        const htmlBeginRegex = other.htmlBeginRegex(indent);
        const blockquoteBeginRegex = other.blockquoteBeginRegex(indent);

        // Check if following lines should be included in List Item
        while (src) {
          const rawLine = src.split('\n', 1)[0];
          let nextLineWithoutTabs;
          nextLine = rawLine;

          // Re-align to follow commonmark nesting rules
          nextLineWithoutTabs = nextLine.replace(other.leadingSpaceTab, whitespace => expandTabs(whitespace));

          // End list item if found code fences
          if (fencesBeginRegex.test(nextLine)) {
            break;
          }

          // End list item if found start of new heading
          if (headingBeginRegex.test(nextLine)) {
            break;
          }

          // End list item if found start of html block
          if (htmlBeginRegex.test(nextLine)) {
            break;
          }

          // End list item if found start of blockquote
          if (blockquoteBeginRegex.test(nextLine)) {
            break;
          }

          // End list item if found start of new bullet
          if (nextBulletRegex.test(nextLine)) {
            break;
          }

          // Horizontal rule found
          if (hrRegex.test(nextLine)) {
            break;
          }

          if (nextLineWithoutTabs.search(other.nonSpaceChar) >= indent || !nextLine.trim()) { // Dedent if possible
            itemContents += '\n' + nextLineWithoutTabs.slice(indent);
          } else {
            // not enough indentation
            if (blankLine) {
              break;
            }

            // paragraph continuation unless last line was a different block level element
            if (line.replace(other.tabCharGlobal, '    ').search(other.nonSpaceChar) >= 4) { // indented code block
              break;
            }
            if (fencesBeginRegex.test(line)) {
              break;
            }
            if (headingBeginRegex.test(line)) {
              break;
            }
            if (htmlBeginRegex.test(line)) {
              break;
            }
            if (hrRegex.test(line)) {
              break;
            }

            // A lazy continuation can look like a setext underline after
            // list indentation is removed. Keep it in the paragraph.
            const setextContinuation = /^ {0,3}(?:=+|-+) *$/.test(nextLine)
              && block.lheading.test(`${line}\n${nextLine}`);
            const continuation = setextContinuation
              ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
              : nextLine;
            itemContents += '\n' + continuation;
          }

          blankLine = !nextLine.trim();

          src = src.substring(rawLine.length + 1);
          line = nextLineWithoutTabs.slice(indent);
        }
      }

      // The loops above appended a '\n' the source may not have had. It could
      // only land on the item that exhausts src, whose raw is trimmed below,
      // and after which nothing reads endsWithBlankLine
      const raw = listSrc.slice(itemStart, taken());

      if (!list.loose) {
        // If the previous item ended with a blank line, the list is loose
        if (endsWithBlankLine) {
          list.loose = true;
        } else if (other.doubleBlankLine.test(raw)) {
          endsWithBlankLine = true;
        }
      }

      list.items.push({
        type: 'list_item',
        raw,
        task: !!other.listIsTask.test(itemContents),
        loose: false,
        text: itemContents,
        tokens: [],
      });
    }

    // Do not consume newlines at end of final item. Alternatively, make itemRegex *start* with any newlines to simplify/speed up endsWithBlankLine logic
    const lastItem = list.items[list.items.length - 1];
    if (lastItem) {
      lastItem.raw = lastItem.raw.trimEnd();
      lastItem.text = lastItem.text.trimEnd();
    } else {
      // not a list since there were no items
      return;
    }
    list.raw = listSrc.slice(0, taken()).trimEnd();

    // Item child tokens handled here at end because we needed to have the final item to trim it first
    // First pass: tokenize items and finalize list.loose from spacers before placing checkboxes
    for (const item of list.items) {
      lx.top = false;
      item.tokens = blockTokens(lx, item.text, [], false);

      if (!list.loose) {
        // Check if list should be loose
        const spacers = item.tokens.filter(t => t.type === 'space');
        const hasMultipleLineBreaks = spacers.length > 0 && spacers.some(t => other.anyLine.test(t.raw));

        list.loose = hasMultipleLineBreaks;
      }
    }

    // Second pass: place task checkboxes using the final list.loose
    for (const item of list.items) {
      const itemToken = item.tokens[0];
      if (item.task && (itemToken && (itemToken.type === 'text' || itemToken.type === 'paragraph'))) {
        // Remove checkbox markdown from item tokens
        item.text = item.text.replace(other.listReplaceTask, '');
        itemToken.raw = itemToken.raw.replace(other.listReplaceTask, '');
        itemToken.text = itemToken.text.replace(other.listReplaceTask, '');
        for (let i = lx.inlineQueue.length - 1; i >= 0; i--) {
          if (other.listIsTask.test(lx.inlineQueue[i].src)) {
            lx.inlineQueue[i].src = lx.inlineQueue[i].src.replace(other.listReplaceTask, '');
            break;
          }
        }

        const taskRaw = other.listTaskCheckbox.exec(item.raw);
        if (taskRaw) {
          const checkboxToken = {
            type: 'checkbox',
            raw: taskRaw[0] + ' ',
            checked: taskRaw[0] !== '[ ]',
          };
          item.checked = checkboxToken.checked;
          if (list.loose) {
            const first = item.tokens[0];
            if (first && (first.type === 'paragraph' || first.type === 'text') && first.tokens) {
              first.raw = checkboxToken.raw + first.raw;
              first.text = checkboxToken.raw + first.text;
              first.tokens.unshift(checkboxToken);
            } else {
              item.tokens.unshift({
                type: 'paragraph',
                raw: checkboxToken.raw,
                text: checkboxToken.raw,
                tokens: [checkboxToken],
              });
            }
          } else {
            item.tokens.unshift(checkboxToken);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    // Set all items to loose if list is loose
    if (list.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const token of item.tokens) {
          if (token.type === 'text') {
            token.type = 'paragraph';
          }
        }
      }
    }

    return list;
  }
}

function htmlToken(lx, src) {
  const cap = block.html.exec(src);
  if (cap) {
    const raw = trimTrailingBlankLines(cap[0]);
    const token = {
      type: 'html',
      block: true,
      raw,
      pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
      text: raw,
    };
    return token;
  }
}

function defToken(lx, src) {
  const cap = block.def.exec(src);
  if (cap) {
    // outside angle brackets a link destination holds only balanced parentheses
    if (!other.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) {
      return;
    }

    const tag = normalizeLabel(cap[1]);
    const href = cap[2] ? cap[2].replace(other.hrefBrackets, '$1').replace(inline.anyPunctuation, '$1') : '';
    const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(inline.anyPunctuation, '$1') : cap[3];
    return {
      type: 'def',
      tag,
      raw: rtrim(cap[0], '\n'),
      href,
      title,
    };
  }
}

function tableToken(lx, src) {
  const cap = block.table.exec(src);
  if (!cap) {
    return;
  }

  if (!other.tableDelimiter.test(cap[2])) {
    // delimiter row must have a pipe (|) or colon (:) otherwise it is a setext heading
    return;
  }

  const headers = splitCells(cap[1]);
  const aligns = cap[2].replace(other.tableAlignChars, '').split('|');
  const rows = cap[3] && cap[3].trim() ? cap[3].replace(other.tableRowBlankLine, '').split('\n') : [];

  const item = {
    type: 'table',
    raw: rtrim(cap[0], '\n'),
    header: [],
    align: [],
    rows: [],
  };

  if (headers.length !== aligns.length) {
    // header and align columns must be equal, rows can be different.
    return;
  }

  for (const align of aligns) {
    if (other.tableAlignRight.test(align)) {
      item.align.push('right');
    } else if (other.tableAlignCenter.test(align)) {
      item.align.push('center');
    } else if (other.tableAlignLeft.test(align)) {
      item.align.push('left');
    } else {
      item.align.push(null);
    }
  }

  for (let i = 0; i < headers.length; i++) {
    item.header.push({
      text: headers[i],
      tokens: inlineQueuePush(lx, headers[i]),
      header: true,
      align: item.align[i],
    });
  }

  for (const row of rows) {
    item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
      return {
        text: cell,
        tokens: inlineQueuePush(lx, cell),
        header: false,
        align: item.align[i],
      };
    }));
  }

  return item;
}

function lheadingToken(lx, src) {
  const cap = block.lheading.exec(src);
  if (cap) {
    const text = cap[1].trim();
    return {
      type: 'heading',
      raw: rtrim(cap[0], '\n'),
      depth: cap[2].charAt(0) === '=' ? 1 : 2,
      text,
      tokens: inlineQueuePush(lx, text),
    };
  }
}

function paragraphToken(lx, src) {
  const cap = block.paragraph.exec(src);
  if (cap) {
    const text = cap[1].charAt(cap[1].length - 1) === '\n'
      ? cap[1].slice(0, -1)
      : cap[1];
    return {
      type: 'paragraph',
      raw: cap[0],
      text,
      tokens: inlineQueuePush(lx, text),
    };
  }
}

function textToken(lx, src) {
  const cap = block.text.exec(src);
  if (cap) {
    return {
      type: 'text',
      raw: cap[0],
      text: cap[0],
      tokens: inlineQueuePush(lx, cap[0]),
    };
  }
}

// ---------------------------------------------------------------------------
// Inline tokenizers (Tokenizer.ts)
// ---------------------------------------------------------------------------

function escapeToken(lx, src) {
  const cap = inline.escape.exec(src);
  if (cap) {
    return {
      type: 'escape',
      raw: cap[0],
      text: cap[1],
    };
  }
}

function tagToken(lx, src) {
  const cap = inline.tag.exec(src);
  if (cap) {
    if (!lx.inLink && other.startATag.test(cap[0])) {
      lx.inLink = true;
    } else if (lx.inLink && other.endATag.test(cap[0])) {
      lx.inLink = false;
    }
    if (!lx.inRawBlock && other.startPreScriptTag.test(cap[0])) {
      lx.inRawBlock = true;
    } else if (lx.inRawBlock && other.endPreScriptTag.test(cap[0])) {
      lx.inRawBlock = false;
    }

    return {
      type: 'html',
      raw: cap[0],
      inLink: lx.inLink,
      inRawBlock: lx.inRawBlock,
      block: false,
      text: cap[0],
    };
  }
}

function isLabelEndInsideToken(src, label, labelStart) {
  if (!label.includes('<')) {
    return false;
  }

  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }

    if (label[i] === '`') {
      const code = inline.code.exec(label.slice(i));
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }

    if (label[i] !== '<') {
      continue;
    }

    const tokenSrc = src.slice(labelStart + i);
    const token = inline.tag.exec(tokenSrc) || inline.autolink.exec(tokenSrc);
    if (!token) {
      continue;
    }

    if (token[0].length > label.length - i) {
      return true;
    }
    i += token[0].length - 1;
  }
  return false;
}

function outputLink(lx, cap, linkObj, raw) {
  const href = linkObj.href;
  const title = linkObj.title || null;
  const text = cap[1].replace(other.outputLinkReplace, '$1');
  const isImage = cap[0].charAt(0) === '!';

  const outerInLink = lx.inLink;
  const outerLinkEmitted = lx.linkEmitted;
  const outerInRawBlock = lx.inRawBlock;
  lx.inLink = true;
  lx.linkEmitted = false;
  const tokens = inlineTokensRun(lx, text);
  const textHasLink = lx.linkEmitted;
  lx.linkEmitted = outerLinkEmitted;
  lx.inLink = outerInLink;

  if (!isImage) {
    // CommonMark: "Links may not contain other links, at any level of nesting."
    // Bail so the caller falls through to text and the inner link is the one kept.
    // Images are exempt: their text is flattened into an alt attribute.
    if (textHasLink) {
      // these tokens are discarded, so undo the raw-block state they opened;
      // leaving it set would suppress escaping for the text that is re-scanned
      lx.inRawBlock = outerInRawBlock;
      return;
    }
    lx.linkEmitted = true;
  }

  return {
    type: isImage ? 'image' : 'link',
    raw,
    href,
    title,
    text,
    tokens,
  };
}

function linkToken(lx, src) {
  // The link regex backtracks quadratically over unterminated-link inputs
  // like '[a](b'.repeat(n): at every '[' its greedy unquoted-href run
  // re-partitions the whole remainder while hunting for a ')' that never
  // comes. inlineTokens anchors one paren scan per run in
  // state.linkParenPossible; when it is false the regex cannot match, so
  // bail out before running it.
  if (lx.linkParenPossible === false) {
    return undefined;
  }
  const cap = inline.link.exec(src);
  if (cap) {
    const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
    if (isLabelEndInsideToken(src, cap[1], labelStart)) {
      return;
    }

    const trimmedUrl = cap[2].trim();
    if (other.startAngleBracket.test(trimmedUrl)) {
      // commonmark requires matching angle brackets
      if (!(other.endAngleBracket.test(trimmedUrl))) {
        return;
      }

      // ending angle bracket cannot be escaped
      const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
      if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
        return;
      }
    } else {
      // find closing parenthesis
      const lastParenIndex = findClosingBracket(cap[2], '()');
      if (lastParenIndex === -2) {
        // more open parens than closed
        return;
      }

      if (lastParenIndex > -1) {
        const start = cap[0].indexOf('!') === 0 ? 5 : 4;
        const linkLen = start + cap[1].length + lastParenIndex;
        cap[2] = cap[2].substring(0, lastParenIndex);
        cap[0] = cap[0].substring(0, linkLen).trim();
        cap[3] = '';
      }
    }
    // The ')' that ends the match is the link closer only when it is not
    // escaped. `[foo](/url\)` has no closer; that paren is destination text.
    const unescaped = rtrim(cap[0].slice(0, -1), '\\');
    if ((cap[0].length - unescaped.length) % 2 === 0) {
      return;
    }
    let href = cap[2];
    let title = '';
    title = cap[3] ? cap[3].slice(1, -1) : '';

    href = href.trim();
    if (other.startAngleBracket.test(href)) {
      href = href.slice(1, -1);
    }
    return outputLink(lx, cap, {
      href: href ? href.replace(inline.anyPunctuation, '$1') : href,
      title: title ? title.replace(inline.anyPunctuation, '$1') : title,
    }, cap[0]);
  }
}

function reflinkToken(lx, src) {
  let cap = inline.reflink.exec(src) || inline.nolink.exec(src);
  if (cap) {
    const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
    if (isLabelEndInsideToken(src, cap[1], labelStart)) {
      return;
    }

    const link = lx.links[normalizeLabel(cap[2] || cap[1])];
    if (!link) {
      const text = cap[0].charAt(0);
      return {
        type: 'text',
        raw: text,
        text,
      };
    }
    return outputLink(lx, cap, link, cap[0]);
  }
}

function emStrongToken(lx, src, maskedSrc, prevChar = '') {
  let match = inline.emStrongLDelim.exec(src);
  if (!match) return;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return;

  const delimChar = match[0][0];
  // A mid-run opener (for example the second star of an unmatched `**`) must
  // only pair with a delimiter that can only close, otherwise it steals the
  // opener of a later span (`**a*b*c` must be `**a<em>b</em>c`).
  const midRun = prevChar === delimChar;

  // The start of this delimiter run may already be behind src, either taken
  // as text after the whole run failed to match or used to close an earlier
  // span. Flanking and rules 9-10 are about the whole run, so find its start.
  const srcStart = maskedSrc.length - src.length;
  let runStart = srcStart;
  while (runStart > 0 && maskedSrc[runStart - 1] === delimChar) {
    runStart--;
  }
  const runPrevChars = [...maskedSrc.slice(Math.max(0, runStart - 2), runStart)];
  const runPrevChar = runPrevChars.length > 0 ? runPrevChars[runPrevChars.length - 1] : '';
  // The other delimiter character counts as punctuation here (`_**a*`)
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!inline.punctuation.exec(runPrevChar);
  if (runStart < srcStart) {
    prevChar = runPrevChar;
  }
  const prevPunct = runStart < srcStart ? runPrevPunct : !!inline.punctuation.exec(prevChar);

  // _ can't be between two alphanumerics. \p{L}\p{N} includes non-english alphabet/numbers as well
  if (match[4] && prevChar.match(other.unicodeAlphaNumeric)) return;

  const nextChar = match[1] || match[3] || '';

  if (!nextChar || !prevChar || prevPunct) {
    // unicode Regex counts emoji as 1 char; spread into array for proper count (used multiple times below)
    const lLength = [...match[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;

    // Rules 9-10 count the whole run, and also apply when the opener could
    // close as well (`a*b**`, where `*` is both left- and right-flanking).
    const runLength = srcStart - runStart + lLength;
    const openerCanClose = !!runPrevChar.trim()
      && (!!nextChar || (delimChar === '*' && !runPrevPunct));
    if (delimChar !== '*' && delimChar !== '_') return;
    const endReg = delimChar === '*' ? inline.emStrongRDelimAst : inline.emStrongRDelimUnd;
    const lastPossibleEmStrongCloserIndex = cachedLastPossibleEmStrongCloserIndex(lx, maskedSrc, delimChar);
    const emStrongCloserWindowStart = maskedSrc.length - src.length + lLength;
    if (lastPossibleEmStrongCloserIndex < emStrongCloserWindowStart) return;
    // Clip maskedSrc to same section of string as src (move to lexer?)
    maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
    const lastPossibleEmStrongCloserIndexInWindow = lastPossibleEmStrongCloserIndex - emStrongCloserWindowStart;
    endReg.lastIndex = 0;

    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleEmStrongCloserIndexInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

      if (!rDelim) continue; // skip single * in __abc*abc__

      rLength = [...rDelim].length;

      if (match[3] || match[4]) { // found another Left Delim
        delimTotal += rLength;
        continue;
      } else if (match[5] || match[6] || openerCanClose) { // either Left or Right Delim
        if (midRun && (match[5] || match[6])) {
          // A mid-run opener cannot close against an ambiguous delimiter that
          // can also open; that delimiter opens its own emphasis span instead.
          break;
        }
        if (runLength % 3 && !((runLength + rLength) % 3)) {
          midDelimTotal += rLength;
          continue; // CommonMark Emphasis Rules 9-10
        }
      }

      delimTotal -= rLength;

      if (delimTotal > 0) continue; // Haven't found enough closing delimiters

      // Remove extra characters. *a*** -> *a*
      rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      // char length can be >1 for unicode characters;
      const lastCharLength = [...match[0]][0].length;
      const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

      // Create `em` if smallest delimiter has odd char count. *a***
      if (Math.min(lLength, rLength) % 2) {
        const text = raw.slice(1, -1);
        return {
          type: 'em',
          raw,
          text,
          tokens: inlineTokensRun(lx, text),
        };
      }

      // Create 'strong' if smallest delimiter has even char count. **a***
      const text = raw.slice(2, -2);
      return {
        type: 'strong',
        raw,
        text,
        tokens: inlineTokensRun(lx, text),
      };
    }
  }
}

function codespanToken(lx, src) {
  const cap = inline.code.exec(src);
  if (cap) {
    let text = cap[2].replace(other.newLineCharGlobal, ' ');
    const hasNonSpaceChars = other.nonSpaceChar.test(text);
    const hasSpaceCharsOnBothEnds = other.startingSpaceChar.test(text) && other.endingSpaceChar.test(text);
    if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
      text = text.substring(1, text.length - 1);
    }
    return {
      type: 'codespan',
      raw: cap[0],
      text,
    };
  }
}

function brToken(lx, src) {
  const cap = inline.br.exec(src);
  if (cap) {
    return {
      type: 'br',
      raw: cap[0],
    };
  }
}

function delToken(lx, src, maskedSrc, prevChar = '') {
  let match = inline.delLDelim.exec(src);
  if (!match) return;

  const nextChar = match[1] || '';

  if (!nextChar || !prevChar || inline.punctuation.exec(prevChar)) {
    // unicode Regex counts emoji as 1 char; spread into array for proper count
    const lLength = [...match[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength;

    const endReg = inline.delRDelim;
    const lastPossibleDelCloserIndex = cachedLastPossibleDelCloserIndex(lx, maskedSrc);
    const delCloserWindowStart = maskedSrc.length - src.length + lLength;
    if (lastPossibleDelCloserIndex < delCloserWindowStart) return;
    // Clip maskedSrc to same section of string as src
    maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
    const lastPossibleDelCloserIndexInWindow = lastPossibleDelCloserIndex - delCloserWindowStart;
    endReg.lastIndex = 0;

    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleDelCloserIndexInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];

      if (!rDelim) continue;

      rLength = [...rDelim].length;

      if (rLength !== lLength) continue;

      if (match[3] || match[4]) { // found another Left Delim
        delimTotal += rLength;
        continue;
      }

      delimTotal -= rLength;

      if (delimTotal > 0) continue; // Haven't found enough closing delimiters

      // Remove extra characters
      rLength = Math.min(rLength, rLength + delimTotal);
      // char length can be >1 for unicode characters
      const lastCharLength = [...match[0]][0].length;
      const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);

      // Create del token - only single ~ or double ~~ supported
      const text = raw.slice(lLength, -lLength);
      return {
        type: 'del',
        raw,
        text,
        tokens: inlineTokensRun(lx, text),
      };
    }
  }
}

function autolinkToken(lx, src) {
  const cap = inline.autolink.exec(src);
  if (cap) {
    let text, href;
    if (cap[2] === '@') {
      text = cap[1];
      href = 'mailto:' + text;
    } else {
      text = cap[1];
      href = text;
    }

    return {
      type: 'link',
      raw: cap[0],
      text,
      href,
      autolink: true,
      tokens: [
        {
          type: 'text',
          raw: text,
          text,
        },
      ],
    };
  }
}

function urlToken(lx, src) {
  let cap = inline.url.exec(src);
  if (cap) {
    let text, href;
    if (cap[2] === '@') {
      text = cap[0];
      href = 'mailto:' + text;
    } else {
      // do extended autolink path validation
      let prevCapZero;
      do {
        prevCapZero = cap[0];
        cap[0] = inline._backpedal.exec(cap[0])[0] ?? '';
      } while (prevCapZero !== cap[0]);
      text = cap[0];
      if (cap[1] === 'www.') {
        href = 'http://' + cap[0];
      } else {
        href = cap[0];
      }
    }
    return {
      type: 'link',
      raw: cap[0],
      text,
      href,
      autolink: true,
      tokens: [
        {
          type: 'text',
          raw: text,
          text,
        },
      ],
    };
  }
}

function inlineTextToken(lx, src) {
  const cap = inline.text.exec(src);
  if (cap) {
    const escaped = lx.inRawBlock;
    return {
      type: 'text',
      raw: cap[0],
      // raw HTML keeps whatever it was written with, everywhere else a numeric
      // character reference stands for the character itself
      text: escaped ? cap[0] : decodeNumericCharacterReferences(cap[0]),
      escaped,
    };
  }
}

// ---------------------------------------------------------------------------
// Lexer (Lexer.ts)
// ---------------------------------------------------------------------------

function inlineQueuePush(lx, src) {
  const tokens = [];
  lx.inlineQueue.push({ src, tokens });
  return tokens;
}

function infiniteLoopError(byte) {
  throw new Error('Infinite loop on byte: ' + byte);
}

/**
 * Does this link text hold a link already? An image does not count: an image
 * may hold a link, a link may not.
 */
function linkInText(lx, text) {
  if (!text.includes('[')) {
    return false;
  }

  const linkRule = inline.link;
  for (const match of text.matchAll(inline.blockSkip)) {
    // blockSkip also matches code spans and html, and the `!` of an image is
    // left out of the match, so read the character before it.
    if (linkRule.test(match[0]) && text.charAt(match.index - 1) !== '!') {
      return true;
    }
  }

  for (const match of text.matchAll(inline.reflinkSearch)) {
    const match0 = match[0];
    const refStart = match0.lastIndexOf('[');
    if (match0.charAt(0) === '!' || !Object.hasOwn(lx.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
      continue;
    }
    // a candidate holding a link is not a link either, so it does not count
    if (refStart > 1 && linkInText(lx, match0.slice(1, refStart - 1))) {
      continue;
    }
    return true;
  }

  return false;
}

/**
 * Mask links, code, html and escapes so emStrong and del do not see their
 * delimiters inside them.
 */
function maskSrc(lx, src) {
  // String with links masked to avoid interference with em and strong
  let maskedSrc = src;

  // Mask out reflinks
  if (src.includes('[')) {
    const reflinkSearch = inline.reflinkSearch;
    const maskReflink = (match0) => {
      const refStart = match0.lastIndexOf('[');
      if (!Object.hasOwn(lx.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
        return match0;
      }
      // CommonMark: "Links may not contain other links, at any level of
      // nesting." A candidate whose text already holds one never becomes a
      // link, so flattening the whole span would hide the emphasis that
      // does still apply inside it. Mask the links it holds instead.
      // Images are exempt: their text is flattened into an alt attribute.
      if (refStart > 1 && match0.charAt(0) !== '!') {
        const text = match0.slice(1, refStart - 1);
        if (linkInText(lx, text)) {
          return '[' + text.replace(reflinkSearch, maskReflink)
            + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match0.length - 2) + ']';
    };
    maskedSrc = maskedSrc.replace(reflinkSearch, maskReflink);
  }

  // Mask out escaped characters.
  // Every mask must keep the length it replaces: emStrong and del line
  // maskedSrc up with src by slicing from the end. `anyPunctuation` matches
  // unicode punctuation, so an escaped astral character is 3 code units.
  // A backslash inside a code span is literal, not an escape. Mask the
  // backticks inside the span instead, so blockSkip still skips all of it.
  maskedSrc = maskedSrc.replace(inline.anyPunctuationOutsideCode, (match0, code, punct) => {
    if (punct) {
      return '+'.repeat(match0.length);
    }
    if (code) {
      return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    }
    return match0;
  });

  // Mask out other blocks
  maskedSrc = maskedSrc.replace(inline.blockSkip, (match0, _link, context) => {
    const offset = context ? context.length : 0;
    return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
  });

  return maskedSrc;
}

function blockTokens(lx, src, tokens, lastParagraphClipped = false) {
  let srcLength = Infinity;
  while (src) {
    if (src.length < srcLength) {
      srcLength = src.length;
    } else {
      infiniteLoopError(src.charCodeAt(0));
      break;
    }

    let token;
    const c0 = src.charCodeAt(0);

    // newline
    if ((c0 === 32 || c0 === 9 || c0 === 10) && (token = spaceToken(lx, src))) {
      src = src.substring(token.raw.length);
      const lastToken = tokens[tokens.length - 1];
      if (token.raw.length === 1 && lastToken !== undefined) {
        // if there's a single \n as a spacer, it's terminating the last line,
        // so move it there so that we don't get unnecessary paragraph tags
        lastToken.raw += '\n';
      } else {
        tokens.push(token);
      }
      continue;
    }

    // code
    if ((c0 === 32 || c0 === 9) && (token = codeToken(lx, src))) {
      src = src.substring(token.raw.length);
      const lastToken = tokens[tokens.length - 1];
      // An indented code block cannot interrupt a paragraph.
      if (lastToken && (lastToken.type === 'paragraph' || lastToken.type === 'text')) {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
        lastToken.text += '\n' + token.text;
        lx.inlineQueue[lx.inlineQueue.length - 1].src = lastToken.text;
      } else {
        tokens.push(token);
      }
      continue;
    }

    // fences
    if ((c0 === 32 || c0 === 96 || c0 === 126) && (token = fencesToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // heading
    if ((c0 === 32 || c0 === 35) && (token = headingToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // hr
    if ((c0 === 32 || c0 === 45 || c0 === 95 || c0 === 42) && (token = hrToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // blockquote
    if ((c0 === 32 || c0 === 62) && (token = blockquoteToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // list
    if ((c0 === 32 || c0 === 42 || c0 === 43 || c0 === 45 || (c0 >= 48 && c0 <= 57)) && (token = listToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // html
    if ((c0 === 32 || c0 === 60) && (token = htmlToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // def
    if ((c0 === 32 || c0 === 91) && (token = defToken(lx, src))) {
      src = src.substring(token.raw.length);
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && (lastToken.type === 'paragraph' || lastToken.type === 'text')) {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
        lastToken.text += '\n' + token.raw;
        lx.inlineQueue[lx.inlineQueue.length - 1].src = lastToken.text;
      } else {
        // The first definition of a label wins, but a later one still consumes its text
        if (!lx.links[token.tag]) {
          lx.links[token.tag] = {
            href: token.href,
            title: token.title,
          };
        }
        tokens.push(token);
      }
      continue;
    }

    // table (gfm)
    if (c0 !== 10 && (token = tableToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // lheading
    if ((token = lheadingToken(lx, src))) {
      src = src.substring(token.raw.length);
      tokens.push(token);
      continue;
    }

    // top-level paragraph
    if (lx.top && c0 !== 10 && (token = paragraphToken(lx, src))) {
      const lastToken = tokens[tokens.length - 1];
      if (lastParagraphClipped && lastToken && lastToken.type === 'paragraph') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
        lastToken.text += '\n' + token.text;
        lx.inlineQueue.pop();
        lx.inlineQueue[lx.inlineQueue.length - 1].src = lastToken.text;
      } else {
        tokens.push(token);
      }
      lastParagraphClipped = false; // cutSrc === src: no extensions to clip to
      src = src.substring(token.raw.length);
      continue;
    }

    // text
    if (c0 !== 10 && (token = textToken(lx, src))) {
      src = src.substring(token.raw.length);
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && lastToken.type === 'text') {
        lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
        lastToken.text += '\n' + token.text;
        lx.inlineQueue.pop();
        lx.inlineQueue[lx.inlineQueue.length - 1].src = lastToken.text;
      } else {
        tokens.push(token);
      }
      continue;
    }

    if (src) {
      infiniteLoopError(src.charCodeAt(0));
      break;
    }
  }

  lx.top = true;
  return tokens;
}

function inlineTokensRun(lx, src, tokens = []) {
  // One paren scan per inline run, shared with linkToken: without a ')'
  // ahead the link regex cannot match, and skipping it avoids its
  // quadratic backtracking over unterminated-link inputs like
  // `'[a](b'.repeat(n)`. A nested run receives a substring of the outer
  // run, so if the outer had no ')' neither does this substring — skip
  // the scan in that case.
  const prevLinkParenPossible = lx.linkParenPossible;
  lx.linkParenPossible = prevLinkParenPossible && src.includes(')');
  try {
    return inlineTokensInner(lx, src, tokens);
  } finally {
    // A nested run (e.g. a link label) anchored on its own substring;
    // restore the outer run's flag for the rest of its loop.
    lx.linkParenPossible = prevLinkParenPossible;
  }
}

function inlineTokensInner(lx, src, tokens) {
  // The masked source is only read by emStrong and del, which need a *, _ or
  // ~ to start. Skip building it for a run without one.
  const needMask = src.includes('*') || src.includes('_') || src.includes('~');
  if (needMask) {
    const maskedSrc = maskSrc(lx, src);

    // One scan of this maskedSrc for the last emphasis, strong, and
    // strikethrough closers, shared by every opener in the pass. Popped
    // when the pass ends so the source is not retained.
    lx.hints.push(scanLastPossibleEmStrongDelClosers(maskedSrc));
    try {
      return tokenizeInlines(lx, src, maskedSrc, tokens);
    } finally {
      lx.hints.pop();
    }
  }
  return tokenizeInlines(lx, src, src, tokens);
}

function isUrlStart(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || c === 46 || c === 95 || c === 43 || c === 45;
}

function tokenizeInlines(lx, src, maskedSrc, tokens) {
  let keepPrevChar = false;
  let prevChar = '';
  let srcLength = Infinity;
  while (src) {
    if (src.length < srcLength) {
      srcLength = src.length;
    } else {
      infiniteLoopError(src.charCodeAt(0));
      break;
    }

    if (!keepPrevChar) {
      prevChar = '';
    }
    keepPrevChar = false;

    let token;
    const c = src.charCodeAt(0);

    // First-char dispatch: the inline tokenizers are anchored, so only a few
    // of them can match a given leading character. Preserves marked's
    // attempt order for every possible leading character.
    switch (c) {
      case 92: { // \
        // escape
        if ((token = escapeToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        // br
        if ((token = brToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      case 60: { // <
        // tag
        if ((token = tagToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        // autolink
        if ((token = autolinkToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      case 91: // [
      case 33: { // !
        // link
        if ((token = linkToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        // reflink, nolink
        if ((token = reflinkToken(lx, src))) {
          src = src.substring(token.raw.length);
          const lastToken = tokens[tokens.length - 1];
          if (token.type === 'text' && lastToken && lastToken.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }
        break;
      }
      case 42: // *
      case 95: { // _
        // em & strong
        if ((token = emStrongToken(lx, src, maskedSrc, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        // url (gfm) — an extended email autolink can start at `_`
        if (c === 95 && !lx.inLink && (token = urlToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      case 96: { // `
        // code
        if ((token = codespanToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      case 32: { // space
        // br
        if ((token = brToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      case 126: { // ~
        // del (gfm)
        if ((token = delToken(lx, src, maskedSrc, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
      default: {
        // url (gfm)
        if (!lx.inLink && isUrlStart(c) && (token = urlToken(lx, src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        break;
      }
    }

    // text
    if ((token = inlineTextToken(lx, src))) {
      src = src.substring(token.raw.length);
      if (token.raw.slice(-1) !== '_') { // Track prevChar before string of ____ started
        prevChar = token.raw.slice(-1);
      }
      keepPrevChar = true;
      const lastToken = tokens[tokens.length - 1];
      if (lastToken && lastToken.type === 'text') {
        lastToken.raw += token.raw;
        lastToken.text += token.text;
      } else {
        tokens.push(token);
      }
      continue;
    }

    if (src) {
      infiniteLoopError(src.charCodeAt(0));
      break;
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser / Renderer (Parser.ts, Renderer.ts, TextRenderer.ts)
// ---------------------------------------------------------------------------

function parseInlineTokens(lx, tokens, plain) {
  let out = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case 'escape': {
        out += plain ? token.text : escapeHtmlEntities(token.text);
        break;
      }
      case 'html': {
        out += token.text;
        break;
      }
      case 'link': {
        out += plain
          ? (token.tokens ? parseInlineTokens(lx, token.tokens, plain) : token.text)
          : renderLink(lx, token);
        break;
      }
      case 'image': {
        out += plain
          ? (token.tokens ? parseInlineTokens(lx, token.tokens, plain) : token.text)
          : renderImage(lx, token);
        break;
      }
      case 'checkbox': {
        out += plain ? token.raw : '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      }
      case 'strong': {
        out += plain
          ? (token.tokens ? parseInlineTokens(lx, token.tokens, plain) : token.text)
          : `<strong>${parseInlineTokens(lx, token.tokens, false)}</strong>`;
        break;
      }
      case 'em': {
        out += plain
          ? (token.tokens ? parseInlineTokens(lx, token.tokens, plain) : token.text)
          : `<em>${parseInlineTokens(lx, token.tokens, false)}</em>`;
        break;
      }
      case 'codespan': {
        out += plain ? token.text : '<code>' + escapeHtmlEntities(token.text, true) + '</code>';
        break;
      }
      case 'br': {
        out += plain ? '' : '<br>';
        break;
      }
      case 'del': {
        out += plain
          ? (token.tokens ? parseInlineTokens(lx, token.tokens, plain) : token.text)
          : `<del>${parseInlineTokens(lx, token.tokens, false)}</del>`;
        break;
      }
      case 'text': {
        out += plain
          ? token.text
          : (token.tokens ? parseInlineTokens(lx, token.tokens, false) : (token.escaped ? token.text : escapeHtmlEntities(token.text)));
        break;
      }
      default: {
        throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
  }
  return out;
}

function renderLink(lx, token) {
  // References are not resolved inside an autolink, so every `&` there is
  // literal. Elsewhere only an `&` that cannot start one needs escaping.
  const parsedText = token.autolink
    ? escapeHtmlEntities(token.text, true)
    : parseInlineTokens(lx, token.tokens, false);
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) {
    return parsedText;
  }
  const href = escapeHtmlEntities(cleanHref, token.autolink);
  let out = '<a href="' + href + '"';
  if (token.title) {
    out += ' title="' + escapeHtmlEntities(token.title) + '"';
  }
  out += '>' + parsedText + '</a>';
  return out;
}

function renderImage(lx, token) {
  let text = token.text;
  if (token.tokens) {
    text = parseInlineTokens(lx, token.tokens, true);
  }
  const cleanHref = cleanUrl(token.href);
  if (cleanHref === null) {
    return escapeHtmlEntities(text);
  }
  const href = cleanHref;

  let out = `<img src="${escapeHtmlEntities(href)}" alt="${escapeHtmlEntities(text)}"`;
  if (token.title) {
    out += ` title="${escapeHtmlEntities(token.title)}"`;
  }
  out += '>';
  return out;
}

function renderTableCell(lx, token) {
  const content = parseInlineTokens(lx, token.tokens, false);
  const type = token.header ? 'th' : 'td';
  const tag = token.align
    ? `<${type} align="${token.align}">`
    : `<${type}>`;
  return tag + content + `</${type}>\n`;
}

function renderTokens(lx, tokens) {
  let out = '';

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case 'space': {
        break;
      }
      case 'hr': {
        out += '<hr>\n';
        break;
      }
      case 'heading': {
        out += `<h${token.depth}>${parseInlineTokens(lx, token.tokens, false)}</h${token.depth}>\n`;
        break;
      }
      case 'code': {
        const langString = (token.lang || '').match(other.notSpaceStart)?.[0];

        // An empty code block has no content, so it must not gain a newline.
        const code = token.text ? token.text.replace(other.endingNewline, '') + '\n' : '';

        if (!langString) {
          out += '<pre><code>' + escapeHtmlEntities(code, true) + '</code></pre>\n';
        } else {
          out += '<pre><code class="language-' + escapeHtmlEntities(langString) + '">' + escapeHtmlEntities(code, true) + '</code></pre>\n';
        }
        break;
      }
      case 'table': {
        let header = '';

        // header
        let cell = '';
        for (let j = 0; j < token.header.length; j++) {
          cell += renderTableCell(lx, token.header[j]);
        }
        header += `<tr>\n${cell}</tr>\n`;

        let body = '';
        for (let j = 0; j < token.rows.length; j++) {
          const row = token.rows[j];

          cell = '';
          for (let k = 0; k < row.length; k++) {
            cell += renderTableCell(lx, row[k]);
          }

          body += `<tr>\n${cell}</tr>\n`;
        }
        if (body) body = `<tbody>${body}</tbody>`;

        out += '<table>\n'
          + '<thead>\n'
          + header
          + '</thead>\n'
          + body
          + '</table>\n';
        break;
      }
      case 'blockquote': {
        out += `<blockquote>\n${renderTokens(lx, token.tokens)}</blockquote>\n`;
        break;
      }
      case 'list': {
        const ordered = token.ordered;
        const start = token.start;

        let body = '';
        for (let j = 0; j < token.items.length; j++) {
          body += `<li>${renderTokens(lx, token.items[j].tokens)}</li>\n`;
        }

        const type = ordered ? 'ol' : 'ul';
        const startAttr = (ordered && start !== 1) ? (' start="' + start + '"') : '';
        out += '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
        break;
      }
      case 'checkbox': {
        out += '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      }
      case 'html': {
        out += token.text;
        break;
      }
      case 'def': {
        break;
      }
      case 'paragraph': {
        out += `<p>${parseInlineTokens(lx, token.tokens, false)}</p>\n`;
        break;
      }
      case 'text': {
        out += token.tokens
          ? parseInlineTokens(lx, token.tokens, false)
          : (token.escaped ? token.text : escapeHtmlEntities(token.text));
        break;
      }
      default: {
        throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Render markdown to HTML byte-for-byte identical to marked 18.1.3 defaults. */
export function parse(markdown) {
  try {
    return parseMarkdown(markdown);
  } catch (e) {
    e.message += '\nPlease report this to https://github.com/markedjs/marked.';
    throw e;
  }
}

function parseMarkdown(markdown) {
  if (markdown.includes('\r')) {
    markdown = markdown.replace(other.carriageReturn, '\n');
  }

  const lx = {
    links: Object.create(null),
    inlineQueue: [],
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
    hints: [],
  };

  const tokens = [];
  blockTokens(lx, markdown, tokens, false);

  for (let i = 0; i < lx.inlineQueue.length; i++) {
    const next = lx.inlineQueue[i];
    // an inline <pre>, <code>, <kbd> or <script> left open ends with the block
    // holding it; carried over, it would stop every later block's text from
    // being escaped
    lx.inRawBlock = false;
    inlineTokensRun(lx, next.src, next.tokens);
  }
  lx.inlineQueue = [];

  return renderTokens(lx, tokens);
}

export default { parse };
