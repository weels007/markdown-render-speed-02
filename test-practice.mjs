import { readFileSync } from 'node:fs';
import { parse } from './parse.js';

const kit = process.argv[2] || '../.makefun/kit/markdown-render-speed-02-kit';
const cases = JSON.parse(readFileSync(`${kit}/practice/input/cases.json`, 'utf8'));
const ref = JSON.parse(readFileSync(`${kit}/practice/reference/expected.json`, 'utf8'));
const expected = ref.cases || ref;

let pass = 0, fail = 0, first = null;
const t0 = performance.now();
for (let i = 0; i < cases.length; i++) {
  const exp = typeof expected[i] === 'string' ? expected[i] : expected[i].html;
  const got = parse(cases[i].markdown);
  if (got === exp) pass++; else {
    fail++;
    if (!first) {
      let k = 0; while (k < got.length && k < exp.length && got[k] === exp[k]) k++;
      first = { id: cases[i].id, idx: i, pos: k, got: got.slice(Math.max(0,k-40), k+40), exp: exp.slice(Math.max(0,k-40), k+40) };
    }
  }
}
const ms = (performance.now() - t0).toFixed(1);
console.log(`practice: ${pass} passed, ${fail} failed, ${ms}ms total (~${(ms/cases.length).toFixed(3)}ms/case)`);
if (first) {
  console.log('first diff:', JSON.stringify(first.id), 'idx', first.idx, 'pos', first.pos);
  console.log('got ...', JSON.stringify(first.got));
  console.log('exp ...', JSON.stringify(first.exp));
  process.exit(1);
}
