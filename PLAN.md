# markdown-render-speed-02 — plan

Goal: a faster, dependency-free drop-in for `marked` **18.1.3** (defaults: GFM on, breaks/pedantic/async off).  
Deliverables (repo root): `parse.js` exporting `parse(markdown)` and `main.ts` (harness entrypoint). Must match marked’s HTML **byte-for-byte** on every case (720: CM 0.31.2 + GFM 0.29 extensions + 40 generated READMEs). No cache across `parse()` calls, no WASM/native/addons/deps/install, repo ≤ 1 MiB. Prize only if faster than house baseline at 95% confidence in final heat.

## Strict transcripts (critical)
This bounty takes **no transcript upload** — only **sealed live recordings** from `makefun record` (witnessed by server). Recorded harnesses: Claude Code, Claude Desktop (Cowork), Codex, Muse app, Superbot, Gemini CLI, Qwen Code, GitHub Copilot CLI, pi, oh-my-pi, DeepSeek Harness, Factory Droid, Grok Build, Muse Code, Kiro CLI v3, CodeBuddy Code, Goose (.jsonl), OpenClaw (.jsonl), Hermes Agent, opencode, ZCode. **Start `record --source <repo>` before the agent writes any code**, build in a session begun after it, and seal on stop. `main.ts` must have ≥1 line authored by the agent in the recorded session.

Kit: `.makefun/kit/markdown-render-speed-02-kit/` (this workspace). Practice = drand round 33735412 (in kit). Scored set drawn 10 min after deadline.

## Baseline
- `main.ts`, `parse.js` copied from kit baseline (marked 18.1.3 via `vendor/marked/marked.esm.js`, MIT+NOTICE kept). Rewrite/optimize in a **recorded** session.

## Optimization strategy
1. **Correctness first**: byte-identical to `vendor/marked/marked.esm.js` (reference of truth) for all practice cases; where marked diverges from spec, follow marked.
2. **Profile the real workload** (practice set: 680 spec + 40 long READMEs) — don’t guess. Find tallest self-time bars, then aggregates (loop from js-perf-notes: profile → hypothesize → one change → verify correctness → measure vs noise → keep/revert → re-profile).
3. **Hot-path ideas** (validate each against correctness+timing):
   - Reduce allocations: reuse buffers/arrays/objects **within a single parse** (never across calls); avoid intermediate strings where safe; prefer char-code/index scans over regex where equivalent.
   - Lexer/tokenizer: fast-path plain text/paragraphs and common block/inline patterns; first-char dispatch; trim redundant regex work/backtracking; cache compiled regexes as module-level constants (built-in source, ok if not per-case output cache).
   - Renderer: minimize function-call overhead in tight loops; efficient string building; avoid repeated property lookups in hot loops.
   - Inline: simple/common cases (plain paragraphs, basic emphasis/links/code spans) before general paths, but preserve exact marked semantics/edge cases.
4. **Never**: table keyed on case text/hash or any case’s HTML; persist anything across `parse()` calls; read clock/env/outside dirs for variation; add deps/WASM/native.
5. **Constraints**: Node 22 erasable TS only, no install, repo ≤ 1,048,576 bytes total, `/output` limits respected, deterministic across two runs.

## Local verification (from kit dir or with kit path)
```sh
# grade dev/practice like server (needs Docker)
node .makefun/kit/markdown-render-speed-02-kit/cli/makefun.mjs grade-local --kit .makefun/kit/markdown-render-speed-02-kit --bot md-speed-02 --driver docker

# verify instance
node .makefun/kit/markdown-render-speed-02-kit/cli/makefun.mjs verify-instance --kit .makefun/kit/markdown-render-speed-02-kit --driver docker

# pre-submit checks (repo state; transcript gate is server-side from recordings)
node .makefun/kit/markdown-render-speed-02-kit/cli/makefun.mjs check --kit .makefun/kit/markdown-render-speed-02-kit --repo md-speed-02
```

## Submit (after sealed recording)
```sh
# GitHub entry (commit pushed)
node .makefun/kit/markdown-render-speed-02-kit/cli/makefun.mjs submit \
  --competition markdown-render-speed-02 \
  --recording <id> \
  --repo-url https://github.com/weels007/<repo> \
  --commit <sha> \
  --title "<name>" \
  --keypair "C:\Users\dhozi\.makefun\keypairs\https_make.fun.json" \
  --repo md-speed-02 \
  --kit .makefun/kit/markdown-render-speed-02-kit
```
Sign-in/key already set for @weels007 (origin https://make.fun). Check practice score before 2026-11-16T20:30:00Z.

## Relevant skills (skills.sh / find-skills)
- `vercel-labs/skills@find-skills` — discover skills: https://www.skills.sh/vercel-labs/skills/find-skills
- `mourner/claudefiles@js-perf-notes` — JS perf loop & V8-minded techniques: `npx skills add github.com/mourner/claudefiles --skill js-perf-notes`
- `gohypergiant/agent-skills@accelint-ts-performance` — `npx skills add github.com/gohypergiant/agent-skills --skill accelint-ts-performance`
