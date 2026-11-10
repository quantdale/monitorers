/**
 * Dead-code scan — the testable core of `check-dead-code.mjs`.
 *
 * Kept separate from the CLI so the scanner's behaviour can be unit-tested
 * (`scripts/dead-code-scan.test.mjs` runs in the canonical Vitest lane): the
 * check's own correctness decides whether a real dead symbol is reported, so
 * it needs red-capable coverage rather than being verified only by "the
 * current tree happens to pass".
 *
 * Two hard-won rules live here:
 *
 *  1. COMMENTS ARE NOT REFERENCES. The first version of the gate counted raw
 *     text occurrences, so a doc comment saying "identical to `sliceWindow`"
 *     counted as a reference to `sliceWindow` — and a function that no code
 *     path called was reported as live. Prose is not a caller.
 *  2. STRINGS, RAW STRINGS, CHAR LITERALS AND LIFETIMES ARE NOT COMMENTS.
 *     A URL (`'http://127.0.0.1:5180'`), a Rust raw string, a `':'` char
 *     literal, a `&'static str` lifetime, and a JSX apostrophe in
 *     `Couldn't load settings` must all survive stripping intact, because
 *     mangling them would fabricate references or delete real ones.
 *
 * Documented limitation: a JavaScript regex literal whose body contains `//`
 * or a block-comment opener would be misread as a comment. No first-party
 * source has one, and such a literal would fail the gate loudly (an
 * unreferenced symbol would appear) rather than silently pass.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Intentional public surface. Each entry MUST carry a reason — an entry
 * without one is itself a finding (the CLI enforces the length floor).
 */
export const ALLOWLIST = new Map([
  [
    'resetMissingSnapshotTimestampWarning',
    'Test seam for the module-level "warn once" guard in resolveSnapshotTimestamp. The guard is intentionally process-wide, so a suite must be able to reset it to assert the "warns exactly once" contract repeatedly without reloading the module. Production code never calls it.',
  ],
]);

const NEWLINE = '\n';

/**
 * Remove comments while preserving everything else verbatim and keeping the
 * ORIGINAL line count (a block comment collapses to the newlines it contained,
 * so reported line numbers still point at the real file).
 *
 * `rust` selects that language's literal rules: Rust has raw strings
 * (`r#"…"#`), char literals (`'/'`, `'\n'`), and lifetimes (`&'static str`)
 * rather than single-quoted strings.
 */
export function stripComments(text, rust = false) {
  const out = [];
  let i = 0;
  const n = text.length;

  /** Index of the closing quote on the same line, or -1 (escapes honoured). */
  const closingQuoteOnLine = (from, quote) => {
    let j = from + 1;
    while (j < n && text[j] !== NEWLINE) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === quote) return j;
      j++;
    }
    return -1;
  };

  /** Index of the closing quote anywhere (multi-line literal), or -1. */
  const closingQuoteAnywhere = (from, quote) => {
    let j = from + 1;
    while (j < n) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === quote) return j;
      j++;
    }
    return -1;
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    // ── Rust raw string: r"…" / r#"…"#
    if (rust && ch === 'r') {
      let hashes = 0;
      let j = i + 1;
      while (text[j] === '#') {
        hashes++;
        j++;
      }
      if (text[j] === '"') {
        const terminator = '"' + '#'.repeat(hashes);
        const end = text.indexOf(terminator, j + 1);
        const stop = end === -1 ? n : end + terminator.length;
        out.push(text.slice(i, stop));
        i = stop;
        continue;
      }
    }

    // ── Line comment
    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== NEWLINE) i++;
      continue;
    }

    // ── Block comment (line count preserved)
    if (ch === '/' && next === '*') {
      let j = i + 2;
      let newlines = 0;
      while (j < n && !(text[j] === '*' && text[j + 1] === '/')) {
        if (text[j] === NEWLINE) newlines++;
        j++;
      }
      i = Math.min(n, j + 2);
      out.push(newlines > 0 ? NEWLINE.repeat(newlines) : ' ');
      continue;
    }

    // ── Double-quoted literal (multi-line only for Rust strings)
    if (ch === '"') {
      const end = rust ? closingQuoteAnywhere(i, '"') : closingQuoteOnLine(i, '"');
      if (end !== -1) {
        out.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }

    // ── Rust char literal / lifetime
    if (rust && ch === "'") {
      const after = text[i + 1];
      if (after === '\\') {
        let j = i + 3; // the escaped character itself
        if (text[i + 2] === 'u' && text[i + 3] === '{') {
          while (j < n && text[j] !== '}') j++;
          j++;
        }
        if (text[j] === "'") {
          out.push(text.slice(i, j + 1));
          i = j + 1;
          continue;
        }
      } else if (after !== undefined && text[i + 2] === "'") {
        out.push(text.slice(i, i + 3));
        i += 3;
        continue;
      }
      // A lifetime (`&'static str`) or a lone apostrophe: copy the quote only.
      out.push(ch);
      i++;
      continue;
    }

    // ── JS/TS single-quoted literal. Only a quote that HAS a same-line
    // closing partner opens a string: JSX text such as `Couldn't load
    // settings` carries a lone apostrophe, and treating it as a string
    // opener would swallow the rest of that line's real code.
    if (!rust && ch === "'") {
      const end = closingQuoteOnLine(i, "'");
      if (end !== -1) {
        out.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }

    // ── JS/TS template literal (may span lines)
    if (!rust && ch === '`') {
      const end = closingQuoteAnywhere(i, '`');
      if (end !== -1) {
        out.push(text.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

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

const wordRe = (name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

/** Load every first-party source the check owns, with comments already removed. */
export function loadSources(appRoot) {
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

  const rustText = allFiles.filter(isRust).map((file) => {
    const parts = rustSplit(readFileSync(file, 'utf8'));
    return { file, prod: stripComments(parts.prod, true), test: stripComments(parts.test, true) };
  });

  const tsFiles = allFiles.filter(isTs);
  const tsProdText = tsFiles
    .filter((f) => !isTsTest(f))
    .map((file) => ({ file, text: stripComments(readFileSync(file, 'utf8'), false) }));
  const tsTestText = tsFiles
    .filter(isTsTest)
    .map((file) => ({ file, text: stripComments(readFileSync(file, 'utf8'), false) }));

  return { rustText, tsProdText, tsTestText };
}

/**
 * Every first-party declaration the check tracks, with reference counts.
 *
 * `declarations` never includes a symbol's own declaration site, so a symbol
 * referenced only by prose has a production count of exactly zero.
 */
export function enumerateDeclarations(sources) {
  const { rustText, tsProdText, tsTestText } = sources;
  const declarations = [];

  const countReferences = (name, declFile, declLineStart) => {
    const re = wordRe(name);
    let prod = 0;
    let test = 0;
    const prodHits = [];

    const countIn = (file, text, isTest) => {
      if (!text) return;
      for (const m of text.matchAll(re)) {
        if (file === declFile && !isTest) {
          const lineNo = text.slice(0, m.index).split(NEWLINE).length;
          if (lineNo === declLineStart) continue; // the declaration itself
        }
        if (isTest) test++;
        else {
          prod++;
          prodHits.push(file);
        }
      }
    };

    for (const doc of rustText) {
      countIn(doc.file, doc.prod, false);
      countIn(doc.file, doc.test, true);
    }
    for (const doc of tsProdText) countIn(doc.file, doc.text, false);

    return { prod, test, prodHits };
  };

  // ── Rust: `pub fn|struct|enum|const|type|trait|mod`
  const RUST_DECL =
    /^\s*pub(?:\(crate\))?\s+(?:async\s+)?(fn|struct|enum|const|type|trait|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const doc of rustText) {
    for (const m of doc.prod.matchAll(RUST_DECL)) {
      const name = m[2];
      const lineStart = doc.prod.slice(0, m.index).split(NEWLINE).length;
      declarations.push({
        lang: 'rust',
        name,
        file: doc.file,
        lineStart,
        counts: countReferences(name, doc.file, lineStart),
      });
    }
  }

  // ── TypeScript: `export function|const|class|interface|type|enum`
  const TS_DECL =
    /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(function|const|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  for (const doc of tsProdText) {
    for (const m of doc.text.matchAll(TS_DECL)) {
      const name = m[2];
      const lineStart = doc.text.slice(0, m.index).split(NEWLINE).length;
      declarations.push({
        lang: 'ts',
        name,
        file: doc.file,
        lineStart,
        counts: countReferences(name, doc.file, lineStart),
      });
    }
  }

  // Test-only references for TypeScript declarations are counted separately:
  // a symbol reached only from a test of itself is still production-dead.
  for (const d of declarations) {
    const re = wordRe(d.name);
    let testRefs = 0;
    for (const doc of tsTestText) testRefs += (doc.text.match(re) ?? []).length;
    d.counts.test = testRefs;
  }

  return declarations;
}

/**
 * Classify declarations into findings.
 *
 *  - `dead`      production count 0: nothing but prose and tests mention it.
 *  - `test-only` same, but some test file does reference it — a function kept
 *                alive by a test of itself is still production-dead.
 *  - `chain`     production references exist, but every one of them lives in a
 *                file whose other declarations are ALL `dead`. Such a symbol
 *                is reachable only from code that is itself unreachable, so it
 *                is reported too, and the `dead` member named in that file is
 *                the identifiable root of the subtree.
 *
 * Attribution is deliberately FILE-scoped (a declaration's references are
 * taken to originate from the declarations sharing its file). That is the
 * strongest claim name-based analysis can make without an AST, so it is
 * conservative: a file holding any live declaration is never treated as a
 * dead-only source, and a symbol is never reported on a guess.
 */
export function classifyDeclarations(declarations, allowlist = ALLOWLIST) {
  const unreferenced = declarations.filter((d) => d.counts.prod === 0);

  const declaredNamesByFile = new Map();
  for (const d of declarations) {
    const names = declaredNamesByFile.get(d.file) ?? new Set();
    names.add(d.name);
    declaredNamesByFile.set(d.file, names);
  }
  const deadNames = new Set(unreferenced.map((d) => d.name));

  const chainMembers = new Set();
  for (const d of declarations) {
    if (d.counts.prod === 0) continue;
    const onlyDeadSources = d.counts.prodHits.every((file) => {
      const siblings = [...(declaredNamesByFile.get(file) ?? new Set())].filter((n) => n !== d.name);
      return siblings.length > 0 && siblings.every((n) => deadNames.has(n));
    });
    if (onlyDeadSources) chainMembers.add(d.name);
  }

  const findings = [];
  for (const d of [...unreferenced, ...declarations.filter((x) => chainMembers.has(x.name) && x.counts.prod > 0)]) {
    const allowed = [...allowlist.keys()].some((k) => k === d.name || k.includes(d.name));
    if (allowed) continue;
    if (chainMembers.has(d.name)) {
      findings.push({
        kind: 'chain',
        label: 'dead chain (referenced only by other unreferenced symbols)',
        sym: d,
      });
    } else if (d.counts.test > 0) {
      findings.push({ kind: 'test-only', label: 'referenced only from test code', sym: d });
    } else {
      findings.push({ kind: 'dead', label: 'referenced nowhere', sym: d });
    }
  }

  return findings;
}

/** Everything the CLI needs in one call. */
export function scan(appRoot, allowlist = ALLOWLIST) {
  const declarations = enumerateDeclarations(loadSources(appRoot));
  return { declarations, findings: classifyDeclarations(declarations, allowlist) };
}
