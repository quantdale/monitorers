#!/usr/bin/env node
/**
 * Dead-code check: report first-party declared symbols that nothing in
 * production references.
 *
 * Why this exists: `hardware::detect`, `hardware::detect_disks`,
 * `CpuIdentity::probe` and the frontend's `gpuId` were all unreachable in
 * production and none of them was flagged by `clippy` or `tsc` — they hid
 * behind `pub` boundaries in a library crate and behind a named export in a
 * frontend module. `clippy` does not report unused `pub` items (they are part
 * of the crate's public API by definition) and `tsc` does not report unused
 * exports (that needs `noUnusedLocals` semantics that do not apply across
 * modules). A finished, correct, unused implementation is the hardest kind of
 * dead code to notice, because it looks like a feature.
 *
 * Zero dependencies, plain Node, platform-agnostic — the same shape as
 * `check-version.mjs`, so it runs identically on the CI `ubuntu-latest`
 * frontend job and the `windows-latest` Rust job.
 *
 * Categories reported separately (task 5.2):
 *   [dead]        referenced NOWHERE — not even from its own test
 *   [test-only]   referenced only from test code
 *   [chain]       referenced only by other unreferenced symbols (dead chain;
 *                 the ROOT is reported)
 *
 * ALLOWLIST (task 5.3): the intentional public surface, one written reason per
 * entry. Adding a name here without a reason fails the check.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appRoot, '..');

/**
 * Intentional public surface. Each entry MUST carry a reason — an entry
 * without one is itself a finding.
 */
const ALLOWLIST = new Map([
  [
    'lib.rs pub use (library facade)',
    'lib.rs re-exports the collector/sensor surface so the app binary and the headless probe examples can share it without reaching into private modules. Individually some of these have no in-crate caller; the facade IS the API.',
  ],
  [
    'resetMissingSnapshotTimestampWarning',
    'Test seam for the module-level "warn once" guard in resolveSnapshotTimestamp. The guard is intentionally process-wide, so a suite must be able to reset it to assert the "warns exactly once" contract repeatedly without reloading the module. Production code never calls it.',
  ],
  [
    'disk_display_name',
    'Called from main.rs; listed here only because the checker counts the bin target separately from the lib and this keeps the allowlist visible if that changes.',
  ],
]);

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'target' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = [
  ...walk(join(appRoot, 'src-tauri', 'src')),
  ...walk(join(appRoot, 'src-tauri', 'examples')),
  ...walk(join(appRoot, 'src-tauri', 'tests')),
  ...walk(join(appRoot, 'src')),
  ...walk(join(appRoot, 'e2e')),
];

const isRust = (f) => extname(f) === '.rs';
const isTs = (f) => extname(f) === '.ts' || extname(f) === '.tsx';
const isTsTest = (f) => /\.test\.tsx?$/.test(f);

const rustFiles = allFiles.filter(isRust);
const tsFiles = allFiles.filter(isTs);
const tsTestFiles = tsFiles.filter(isTsTest);
const tsProdFiles = tsFiles.filter((f) => !isTsTest(f));

/**
 * Split a Rust file at its first `#[cfg(test)]`: everything before is
 * production, everything from there on is test-only. Rust co-locates its test
 * module at the bottom of the source file, so this is exact for this
 * repository's stated convention rather than a heuristic over arbitrary code.
 */
function rustSplit(text) {
  const i = text.indexOf('#[cfg(test)]');
  return i === -1 ? { prod: text, test: '' } : { prod: text.slice(0, i), test: text.slice(i) };
}

const rustText = rustFiles.map((f) => ({ file: f, ...rustSplit(readFileSync(f, 'utf8')) }));
const tsProdText = tsProdFiles.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
const tsTestText = tsTestFiles.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));

const wordRe = (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

function countOutsideDeclaration(name, declFile, declLineStart, docs) {
  const re = wordRe(name);
  let prod = 0;
  let test = 0;
  const prodHits = [];
  for (const doc of docs) {
    const text = doc.text ?? doc.prod;
    const isTestDoc = 'test' in doc && doc.test !== undefined && doc.text === undefined;
    const hits = text.match(re) ?? [];
    for (let i = 0; i < hits.length; i++) {
      // Skip the declaration itself (same file AND on/adjacent to the decl line).
      if (doc.file === declFile) {
        const offset = [...text.matchAll(re)].map((m) => m.index)[i];
        const lineNo = text.slice(0, offset).split('\n').length;
        if (lineNo === declLineStart) continue;
      }
      if (isTestDoc) test++;
      else {
        prod++;
        prodHits.push(relative(appRoot, doc.file));
      }
    }
  }
  return { prod, test, prodHits };
}

/** Also count Rust test-module text separately. */
function countRust(name, declFile, declLineStart) {
  const re = wordRe(name);
  let prod = 0;
  let test = 0;
  const prodHits = [];
  const lineOffsets = new Map();
  for (const doc of rustText) {
    const countIn = (text, isTest) => {
      if (!text) return;
      for (const m of text.matchAll(re)) {
        if (doc.file === declFile && !isTest) {
          const lineNo = text.slice(0, m.index).split('\n').length;
          if (lineNo === declLineStart) continue;
        }
        if (isTest) test++;
        else {
          prod++;
          prodHits.push(relative(appRoot, doc.file));
        }
      }
    };
    countIn(doc.prod, false);
    countIn(doc.test, true);
  }
  return { prod, test, prodHits };
}

const declarations = [];

// ── Rust: `pub fn|struct|enum|const|type|trait|mod` ──
const RUST_DECL =
  /^\s*pub(?:\(crate\))?\s+(?:async\s+)?(fn|struct|enum|const|type|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
for (const doc of rustText) {
  for (const m of doc.prod.matchAll(RUST_DECL)) {
    const name = m[2];
    const lineStart = doc.prod.slice(0, m.index).split('\n').length;
    declarations.push({ lang: 'rust', name, file: doc.file, lineStart, counts: countRust(name, doc.file, lineStart) });
  }
}

// ── TypeScript: `export function|const|class|interface|type|enum|abstract class` ──
const TS_DECL =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function|const|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
for (const doc of tsProdText) {
  for (const m of doc.text.matchAll(TS_DECL)) {
    const name = m[2];
    const lineStart = doc.text.slice(0, m.index).split('\n').length;
    declarations.push({ lang: 'ts', name, file: doc.file, lineStart, counts: countOutsideDeclaration(name, doc.file, lineStart, tsProdText) });
  }
}

// Test-code references for TS declarations (counted separately).
for (const d of declarations.filter((x) => x.lang === 'ts')) {
  const re = wordRe(d.name);
  let testRefs = 0;
  for (const doc of tsTestText) {
    testRefs += (doc.text.match(re) ?? []).length;
  }
  d.counts.test = testRefs;
}

const unreferenced = declarations.filter((d) => d.counts.prod === 0);
const byName = new Map(unreferenced.map((d) => [d.name, d]));

// A dead chain: a symbol referenced only by OTHER unreferenced symbols.
const chainMembers = new Set();
for (const d of unreferenced) {
  const re = wordRe(d.name);
  for (const other of unreferenced) {
    if (other === d || other.name === d.name) continue;
    const hit =
      other.counts.prodHits.some((f) => f === relative(appRoot, d.file)) ||
      other.counts.test > 0;
    if (hit) chainMembers.add(d.name);
  }
}

const findings = [];
for (const d of unreferenced) {
  const allowed = [...ALLOWLIST.keys()].some((k) => k === d.name || k.includes(d.name));
  if (allowed) continue;
  if (d.counts.test > 0) {
    findings.push({
      kind: 'test-only',
      label: 'referenced only from test code',
      sym: d,
    });
  } else if (chainMembers.has(d.name)) {
    findings.push({ kind: 'chain', label: 'dead chain (referenced only by other unreferenced symbols)', sym: d });
  } else {
    findings.push({ kind: 'dead', label: 'referenced nowhere', sym: d });
  }
}

for (const [name, reason] of ALLOWLIST) {
  if (!reason || reason.trim().length < 20) {
    console.error(`allowlist entry "${name}" has no written reason — every allowlist entry must justify itself.`);
    process.exit(1);
  }
}

if (findings.length > 0) {
  const lines = findings.map((f) => {
    const rel = relative(repoRoot, f.sym.file);
    return `  [${f.kind}] ${f.sym.lang} ${f.sym.name} — ${f.label} (${rel}:${f.sym.lineStart})`;
  });
  console.error(`dead-code check FAILED — ${findings.length} unreferenced first-party symbol(s):`);
  console.error(lines.join('\n'));
  console.error('');
  console.error('Delete the symbol, wire it up, or add it to ALLOWLIST in scripts/check-dead-code.mjs');
  console.error('with a written reason. Intentional public surface belongs in ALLOWLIST, not in a');
  console.error('silent exclusion here.');
  process.exit(1);
}

console.log(
  `dead-code check: ${declarations.length} first-party symbols enumerated ` +
    `(${declarations.filter((d) => d.lang === 'rust').length} Rust, ${declarations.filter((d) => d.lang === 'ts').length} TypeScript), ` +
    `0 unreferenced (${ALLOWLIST.size} allowlisted with reasons)`,
);