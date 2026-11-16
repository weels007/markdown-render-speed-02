// Harness entrypoint: reads /input/cases.json, renders each case with parse(), writes /output/html.json.
// Output is a JSON array of 720 HTML strings in the same order as input cases.
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR override /input and /output for local runs.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as Case[];
// The harness normally provides /output; make local dry runs work too. Each
// case is parsed exactly once, in input order, so the output is deterministic.
mkdirSync(OUTPUT_DIR, { recursive: true });
const html = new Array<string>(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
