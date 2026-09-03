#!/usr/bin/env node
/**
 * The CI gate, run locally on `git push`.
 *
 * WHY THIS EXISTS. GitHub Actions was blocked account-wide from 2026-08-09
 * to 2026-08-31 - every run on every repo failed in ~3 seconds ("The job was
 * not started because recent account payments have failed"), before executing
 * a single step. Sixteen repos carried a ci.yml and not one of them ran. This
 * restores the gate on the workstation, at `git push` - the moment work leaves
 * the machine.
 *
 * IT NOW CHECKS INSTEAD OF ASSUMING (2026-09-03). The original printed
 * "GitHub Actions is off (billing)" unconditionally and ran the full gate
 * every time - so once billing was fixed, every push in sixteen repos paid
 * ~4 minutes to redo work Actions was already doing, while the banner said
 * something false. The gate now asks GitHub whether the last CI run went
 * green and steps aside when it did.
 *
 * THE SKIP IS FAIL-SAFE, and that direction is the whole design. It stands
 * down ONLY on a positive, recent green from `gh`. Every uncertainty - no gh,
 * not authenticated, no network, no ci.yml, no runs, a stale last run, a red
 * last run - RUNS the gate. Being wrong about "Actions has this" means
 * shipping unchecked code; being wrong the other way costs four minutes.
 *
 * GENERATED FILE. Canonical source:
 *   ~/coding/engineering-standards/scripts/templates/check-ci-local.mjs
 * Re-stamp with `engineering-standards/scripts/install-local-ci.sh <repo>`.
 * Per-repo differences belong in `.ci-local.json`, NOT in edits here - eight
 * divergent copies of a gate is the failure the standards repo exists to stop.
 *
 * WHAT IT RUNS. Auto-detected from each package.json: typecheck, lint, test
 * (test:ci / test:coverage / test, first match), build. Blocking, because those
 * are facts about your diff. `audit` is warn-only: it fails on dependency NEWS,
 * and an advisory published overnight blocking a CSS-only push is how a gate
 * earns a reflexive --no-verify.
 *
 * THE HONESTY RULE. This gate is a SUBSTITUTE for ci.yml, so the dangerous
 * failure is passing while silently covering less than CI did. Two guards:
 *   - Missing tooling is UNCHECKED and EXITS NONZERO, never a quiet pass.
 *   - Every run diffs its own steps against ci.yml's `run:` lines and prints
 *     what it does NOT cover. A green run that skipped half of CI must say so.
 *
 * Bypass: `git push --no-verify`, or SKIP_LOCAL_CI=1.
 * Force the gate even when Actions is green: LOCAL_CI_FORCE=1.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = process.env.CI_LOCAL_ROOT || process.cwd();
const C = process.stdout.isTTY
  ? { r:'\x1b[0;31m', g:'\x1b[0;32m', y:'\x1b[1;33m', c:'\x1b[0;36m', d:'\x1b[2m', n:'\x1b[0m' }
  : { r:'', g:'', y:'', c:'', d:'', n:'' };

if (process.env.SKIP_LOCAL_CI === '1') {
  console.log(`${C.y}[local-ci] SKIP_LOCAL_CI=1 - gate bypassed${C.n}`);
  process.exit(0);
}

const range = process.argv[2] || '';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Per-repo config. Absent is fine - the defaults cover a single-package repo. */
const cfg = readJson(join(ROOT, '.ci-local.json')) || {};
const dirs        = cfg.dirs        ?? ['.'];
const skip        = new Set(cfg.skip ?? []);
const extraSteps  = cfg.extraSteps  ?? [];
const ignoreGlobs = cfg.docsOnlyIgnore ?? ['^[^/]+\\.md$', '^docs/'];

// ── docs-only skip ───────────────────────────────────────────────────────────
if (range) {
  const diff = spawnSync('git', ['diff', '--name-only', range], { cwd: ROOT, encoding: 'utf8' });
  const files = (diff.stdout || '').split('\n').filter(Boolean);
  if (files.length) {
    const res = ignoreGlobs.map((g) => new RegExp(g));
    if (files.every((f) => res.some((re) => re.test(f)))) {
      console.log(`${C.c}[local-ci] docs-only push - skipping${C.n}`);
      process.exit(0);
    }
  }
}

// ── is GitHub Actions actually covering this push? ───────────────────────────
// Returns a reason to RUN the gate, or null when Actions is confirmed healthy
// and we can stand down. Every failure path returns a reason: we skip only on
// evidence, never on the absence of it.
function reasonToRunGate() {
  if (process.env.LOCAL_CI_FORCE === '1') return 'LOCAL_CI_FORCE=1';
  if (!existsSync(join(ROOT, '.github/workflows/ci.yml'))) return 'no .github/workflows/ci.yml';

  const gh = spawnSync(
    'gh',
    ['run', 'list', '--workflow', 'ci.yml', '--limit', '1',
     '--json', 'conclusion,status,createdAt,updatedAt,url'],
    { cwd: ROOT, encoding: 'utf8', timeout: 15000 }
  );
  if (gh.error || gh.status !== 0) {
    const why = gh.error?.code === 'ENOENT' ? 'gh not installed'
      : gh.error?.code === 'ETIMEDOUT' ? 'gh timed out'
      : 'gh could not read run history';
    return why;
  }

  let runs;
  try { runs = JSON.parse(gh.stdout || '[]'); } catch { return 'gh returned unparseable JSON'; }
  if (!Array.isArray(runs) || runs.length === 0) return 'no CI runs on record';

  const [last] = runs;
  // A queued or running job is itself proof that Actions is ALIVE: the outage
  // this gate substitutes for kills runs in ~3s before a runner is ever
  // assigned, so nothing ever reaches these states under it. Treating them as
  // "unknown" made every rapid second push redo the full gate.
  if (last.status === 'queued' || last.status === 'in_progress') return null;
  if (last.status !== 'completed') return `last CI run is ${last.status}`;
  // A red run is deliberately NOT a stand-down. Billing failures land here too,
  // and if main is already broken a fast local signal beats waiting on CI.
  if (last.conclusion !== 'success') {
    // ...but SAY SO when the shape says billing rather than code. A run blocked
    // on spend dies in seconds without assigning a runner, and GitHub reports it
    // as "recent account payments have failed OR your spending limit needs to be
    // increased" - naming the wrong cause first. That sentence sent us hunting a
    // card for three weeks in Aug 2026 while the real cause was a $0 product
    // budget with stop-usage on. A card is not a budget; check both.
    const secs = (new Date(last.updatedAt) - new Date(last.createdAt)) / 1000;
    if (Number.isFinite(secs) && secs >= 0 && secs < 20) {
      console.log('');
      console.log(`${C.y}[local-ci] ⚠  The last CI run failed in ${secs.toFixed(0)}s. That is too fast to be${C.n}`);
      console.log(`${C.y}           your code - a run that dies before a runner is assigned is almost${C.n}`);
      console.log(`${C.y}           always SPEND, not a failed payment, whatever the message says.${C.n}`);
      console.log(`${C.d}           Check BOTH: Settings > Billing > Payment information, and${C.n}`);
      console.log(`${C.d}           Settings > Billing > Budgets and alerts (a $0 budget with${C.n}`);
      console.log(`${C.d}           "Stop usage: Yes" hard-stops every job and reads as $0 spent).${C.n}`);
      if (last.url) console.log(`${C.d}           ${last.url}${C.n}`);
    }
    return `last CI run ${last.conclusion}`;
  }

  // A repo that has not pushed in a month proves nothing about today's billing.
  const ageDays = (Date.now() - new Date(last.createdAt).getTime()) / 86400000;
  if (!Number.isFinite(ageDays)) return 'last CI run has no usable timestamp';
  if (ageDays > 30) return `last CI run is ${Math.round(ageDays)} days old`;

  return null;
}

const runReason = reasonToRunGate();
if (runReason === null) {
  console.log(`${C.g}[local-ci] GitHub Actions is green - it covers this push. Standing down.${C.n}`);
  console.log(`${C.d}           Force the local gate with LOCAL_CI_FORCE=1.${C.n}`);
  process.exit(0);
}

console.log(`${C.c}[local-ci] Actions not confirmed green (${runReason}). Running the gate here.${C.n}`);
if (range) console.log(`${C.d}           range: ${range}${C.n}`);
console.log('');

// ── plan ─────────────────────────────────────────────────────────────────────
// Which scripts does ci.yml actually invoke? PREFER THOSE over our default
// order - the gate's job is to mirror CI, not to pick the most thorough-sounding
// script name. nobler-os's ci.yml runs `pnpm test`; preferring `test:coverage`
// ran the Python analyst suites, which need venvs CI never had, and crashed with
// a bus error. A gate that runs something CI never ran is not the gate.
const ciPath = join(ROOT, '.github/workflows/ci.yml');
const ciScripts = new Set();
if (existsSync(ciPath)) {
  for (const line of readFileSync(ciPath, 'utf8').split('\n')) {
    const m = line.match(/(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/);
    if (m && !['ci', 'install', 'audit'].includes(m[1])) ciScripts.add(m[1]);
  }
}

const pmFor = (dir) =>
  existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
  : existsSync(join(dir, 'yarn.lock')) ? 'yarn'
  : 'npm';

/** First script that exists wins - repos disagree on test:ci vs test:coverage vs test. */
const PICK = [
  { key: 'typecheck', names: ['typecheck', 'type-check', 'tsc'],            mode: 'block' },
  { key: 'lint',      names: ['lint'],                                       mode: 'block' },
  { key: 'test',      names: ['test:ci', 'test:coverage', 'test'],           mode: 'block' },
  { key: 'build',     names: ['build'],                                      mode: 'block' },
];

const steps = [];
const missingPkg = [];
for (const d of dirs) {
  const abs = resolve(ROOT, d);
  const allSkipped = PICK.every(({ key }) => skip.has(key) || skip.has(`${d}:${key}`))
    && (skip.has('audit') || skip.has(`${d}:audit`));
  const pkg = readJson(join(abs, 'package.json'));
  // A repo whose gate is entirely extraSteps (Unity, pure-Python) legitimately
  // has no package.json. Only a dir we still need to read from is a failure.
  if (!pkg) { if (!allSkipped) missingPkg.push(d); continue; }
  if (!allSkipped && !existsSync(join(abs, 'node_modules'))) {
    console.log(`${C.y}[local-ci] ${d}: no node_modules - install first, or this reports UNCHECKED${C.n}`);
  }
  const scripts = pkg.scripts || {};
  const pm = pmFor(abs);
  const label = (n) => (dirs.length > 1 ? `${d}: ${n}` : n);
  for (const { key, names, mode } of PICK) {
    if (skip.has(key) || skip.has(`${d}:${key}`)) continue;
    // Run a step only if ci.yml actually invokes it. A package.json `build` that
    // CI never runs is not part of the gate - lead-gen-strategist has one, and
    // running it OOM'd the workstation and reported a red build CI would never
    // have produced. Being stricter than CI is not a virtue here: it manufactures
    // failures, and a gate you have to explain away is a gate you turn off.
    // No ci.yml at all => nothing to mirror, so fall back to everything found.
    const hit = names.find((n) => scripts[n] && ciScripts.has(n))
      ?? (ciScripts.size ? null : names.find((n) => scripts[n]));
    if (hit) steps.push({ label: label(hit), cmd: pm, args: ['run', hit], cwd: abs, mode });
  }
  if (!skip.has('audit')) {
    const args = pm === 'pnpm'
      ? ['audit', '--audit-level=high', '--prod']
      : ['audit', '--omit=dev', '--audit-level=high'];
    steps.push({ label: label('audit'), cmd: pm, args, cwd: abs, mode: 'warn' });
  }
}
for (const s of extraSteps) {
  steps.push({
    label: s.label, cmd: 'bash', args: ['-c', s.cmd],
    cwd: resolve(ROOT, s.dir || '.'), mode: s.mode || 'block',
  });
}

// ── refuse to report a pass we did not earn ──────────────────────────────────
if (missingPkg.length) {
  console.log(`${C.r}[local-ci] UNCHECKED: no package.json in ${missingPkg.join(', ')}${C.n}`);
  console.log(`${C.y}           Fix .ci-local.json "dirs". Refusing to report a pass.${C.n}`);
  process.exit(1);
}
if (!steps.length) {
  console.log(`${C.r}[local-ci] UNCHECKED: detected no runnable steps.${C.n}`);
  console.log(`${C.y}           A gate that checks nothing must not exit green.${C.n}`);
  process.exit(1);
}

// ── run ──────────────────────────────────────────────────────────────────────
const failed = [], warned = [], t0 = Date.now();
for (const s of steps) {
  const st = Date.now();
  process.stdout.write(`  ${s.label.padEnd(30)}`);
  // maxBuffer is NOT optional. Node's default is 1 MiB, and it does not truncate -
  // it KILLS the child. nobler-os's `pnpm test` emits 1,096,663 bytes and passes;
  // at the default it was killed at ~1 MiB and reported FAIL, a false red on a
  // green suite. A gate that fails a passing build gets bypassed on day one, so
  // this is the difference between a gate and a nuisance.
  const r = spawnSync(s.cmd, s.args, {
    cwd: s.cwd, encoding: 'utf8', shell: process.platform === 'win32',
    maxBuffer: 256 * 1024 * 1024,
    // No TTY and no stdin: a step that wants to prompt must fail, not wait.
    // `next lint` on an unconfigured repo asks "How would you like to configure
    // ESLint?" and rendered an arrow-key menu into the captured output.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const dt = ((Date.now() - st) / 1000).toFixed(0);
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error && r.error.code === 'ENOBUFS') {
    console.log(`${C.r}UNCHECKED${C.n} ${C.d}(output exceeded maxBuffer - we killed it, it did not fail)${C.n}`);
    failed.push(`${s.label} (output overflow)`);
  } else if (r.error && r.error.code === 'ENOENT') {
    console.log(`${C.r}UNCHECKED${C.n} ${C.d}(${s.cmd} not found)${C.n}`);
    failed.push(`${s.label} (tooling missing)`);
  } else if (r.status !== 0 && /\b(?:sh|bash|env|zsh): .*(?:command )?not found/.test(out)) {
    console.log(`${C.r}UNCHECKED${C.n} ${C.d}(tool missing - stale install? run the repo's install)${C.n}`);
    failed.push(`${s.label} (tool missing, not a code failure)`);
  } else if (r.status === 0) {
    console.log(`${C.g}pass${C.n} ${C.d}(${dt}s)${C.n}`);
  } else if (s.mode === 'warn') {
    console.log(`${C.y}warn${C.n} ${C.d}(${dt}s)${C.n}`);
    warned.push(s.label);
  } else {
    console.log(`${C.r}FAIL${C.n} ${C.d}(${dt}s)${C.n}`);
    failed.push(s.label);
    console.log(out.trimEnd().split('\n').slice(-25).map((l) => `      ${l}`).join('\n'));
  }
}

// ── coverage vs ci.yml ───────────────────────────────────────────────────────
// The point of the whole file: say out loud what CI checked and we do not.
const uncovered = [];
if (existsSync(ciPath)) {
  const ran = steps.map((s) => `${s.args.join(' ')} ${s.label}`).join(' ');
  // extraSteps must be in the haystack too - a step declared in the manifest
  // being reported as uncovered is a warning that cries wolf, and a warning
  // that cries wolf gets ignored, which defeats the coverage report entirely.
  const declaredCmds = extraSteps.map((s) => s.cmd);
  const declared = declaredCmds.join(' ');
  for (const line of readFileSync(ciPath, 'utf8').split('\n')) {
    const m = line.match(/^\s+run:\s+(.+)$/);
    if (!m) continue;
    const cmd = m[1].trim();
    if (/^\|/.test(cmd) || /^(npm|pnpm|yarn) (ci|install)/.test(cmd)) continue; // installs aren't checks
    // `npm test` and `pnpm lint` invoke a script with no `run` verb - matching
    // only /run\s+/ reported covered steps as uncovered, which trains you to
    // ignore the one warning that matters.
    const script = cmd.match(/^(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/)?.[1] ?? null;
    // Containment BOTH ways: ci.yml wraps steps in compound commands
    // (`node --version && npm run smoke:bundle`), so an exact match misses a
    // step we genuinely run.
    const covered = declaredCmds.some((d) => d && (cmd.includes(d) || d.includes(cmd)))
      || (script ? (ran.includes(script) || declared.includes(script)) : /audit/.test(cmd));
    if (!covered && !uncovered.includes(cmd)) uncovered.push(cmd);
  }
}

const total = ((Date.now() - t0) / 1000).toFixed(0);
console.log('');
if (uncovered.length) {
  console.log(`${C.y}[local-ci] NOT covered locally (ci.yml runs these, this gate does not):${C.n}`);
  for (const u of uncovered) console.log(`${C.y}           - ${u}${C.n}`);
  console.log(`${C.d}           Add them to .ci-local.json "extraSteps" if they matter here.${C.n}`);
}
if (warned.length) console.log(`${C.y}[local-ci] warnings (not blocking): ${warned.join(', ')}${C.n}`);
if (failed.length) {
  console.log(`${C.r}[local-ci] FAILED in ${total}s: ${failed.join(', ')}${C.n}`);
  console.log(`${C.y}           Push blocked. Fix, or bypass with: git push --no-verify${C.n}`);
  process.exit(1);
}
console.log(`${C.g}[local-ci] gate passed in ${total}s${C.n}`);
