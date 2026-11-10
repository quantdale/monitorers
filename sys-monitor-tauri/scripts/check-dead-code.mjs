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
 * The scanner itself lives in `dead-code-scan.mjs` so it has red-capable
 * unit coverage (`dead-code-scan.test.mjs`, part of the Vitest lane). This
 * file is only the reporting CLI.
 *
 * Categories reported separately:
 *   [dead]        referenced NOWHERE — not even from its own test
 *   [test-only]   referenced only from test code
 *   [chain]       referenced only by other unreferenced symbols (dead chain;
 *                 the ROOT is reported)
 *
 * ALLOWLIST lives in `dead-code-scan.mjs`: the intentional public surface, one
 * written reason per entry. Adding a name there without a reason fails here.
 */
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWLIST, scan } from './dead-code-scan.mjs';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appRoot, '..');

for (const [name, reason] of ALLOWLIST) {
  if (!reason || reason.trim().length < 20) {
    console.error(`allowlist entry "${name}" has no written reason — every allowlist entry must justify itself.`);
    process.exit(1);
  }
}

const { declarations, findings } = scan(appRoot);

if (findings.length > 0) {
  const lines = findings.map((f) => {
    const rel = relative(repoRoot, f.sym.file);
    return `  [${f.kind}] ${f.sym.lang} ${f.sym.name} — ${f.label} (${rel}:${f.sym.lineStart})`;
  });
  console.error(`dead-code check FAILED — ${findings.length} unreferenced first-party symbol(s):`);
  console.error(lines.join('\n'));
  console.error('');
  console.error('Delete the symbol, wire it up, or add it to ALLOWLIST in scripts/dead-code-scan.mjs');
  console.error('with a written reason. Intentional public surface belongs in ALLOWLIST, not in a');
  console.error('silent exclusion here.');
  process.exit(1);
}

const rustCount = declarations.filter((d) => d.lang === 'rust').length;
const tsCount = declarations.length - rustCount;
console.log(
  `dead-code check: ${declarations.length} first-party symbols enumerated ` +
    `(${rustCount} Rust, ${tsCount} TypeScript), 0 unreferenced ` +
    `(${ALLOWLIST.size} allowlisted with reasons)`,
);
