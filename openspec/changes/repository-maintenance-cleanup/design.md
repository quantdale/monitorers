## Context

`scripts/check-dead-code.mjs` scanned sources with a single pass over raw text and matched identifiers with a word-boundary regex. That design has one structural defect and two consequences.

**The defect.** Comments are text. A doc comment reading "identical to `sliceWindow`" is a *word-boundary match* for `sliceWindow`, so the function counted as referenced. The same mechanism hid `clearSimScenario`, whose own doc comment claimed journeys called it. Removing the two symbols was not possible before fixing the counter, because the gate certified the tree as clean.

**The consequence for chains.** The original chain detection asked, per pair of unreferenced symbols, whether one's reference list *contained the other's file*. That reports "A is referenced only by other unreferenced code" for symbols that in fact have no reference at all, and it cannot report a symbol whose references live in a file that is entirely dead but whose individual symbols are not chained to it.

## Goals / Non-Goals

**Goals**

- A comment never counts as a reference, in either direction: it neither makes a dead symbol look live nor makes a live one look dead.
- Literals are never mangled. Stripping that corrupts a URL, a Rust raw string, a char literal, a lifetime, or a JSX apostrophe would trade one false verdict for another.
- Reported line numbers still point at the real file, so a finding is actionable without re-deriving the mapping.
- The scanner has red-capable tests in the existing lane, so this cannot regress silently a third time.

**Non-Goals**

- No AST parsing. The gate stays zero-dependency and byte-oriented; a false positive is acceptable (it fails loudly and a human reads it), a false negative is not.
- No new dependency, no new lane, no new workflow step. The tests ride the existing Vitest project.
- No change to what counts as a declaration, and no change to the allowlist contract (a written reason remains mandatory).

## Decisions

**D1 — Strip comments with a hand-written scanner, not a regex.** A regex cannot distinguish `'http://127.0.0.1:5180'` from a line comment, cannot honour escapes, and cannot know that Rust `'a` is a lifetime rather than an unterminated string. The scanner therefore walks characters and tracks exactly these literal forms: double-quoted strings, Rust raw strings (`r"…"`, `r#"…"#`), Rust char literals (`'/'`, `'\n'`), Rust lifetimes (a lone `'`), JS/TS template literals, and JS/TS single-quoted strings.

*Rejected:* a `//`-to-end-of-line regex plus a `/*…*/` regex. Cheaper to write, but it corrupts the URL literal in every Playwright config in the repository, which is a live reference-bearing string.

**D2 — A single quote opens a JS/TS string only when it has a same-line closing partner.** JSX text carries lone apostrophes (`Couldn't load settings — {error}. Try restarting.`). Treating one as an opener swallows the rest of the real code on that line. Requiring a partner on the same line is exactly the rule JavaScript itself uses, and it leaves lifetimes alone because they are Rust-only.

*Consequence, documented in the module:* a JS regex literal whose body contains `//` or a block-comment opener is misread as a comment. No first-party source has one, and such a literal degrades to a spurious finding — loud, never silent.

**D3 — Block comments collapse to the newlines they contained.** Line numbers are how findings are located. Emitting one space for a multi-line comment shifts every later line, so a real finding would name the wrong line. Preserving the newline count keeps `file:line` exact and costs one `'\n'.repeat(n)`.

**D4 — Chain attribution becomes file-membership, not file-comparison.** A symbol is a chain member when it has production references AND every file among those references declares only symbols that are themselves unreferenced (excluding its own name). A file holding any live declaration is never treated as a dead-only source, which is the conservative direction: it under-reports chains rather than inventing them. The root stays labelled `referenced nowhere`.

*Rejected:* following the reference graph transitively. Name-based analysis cannot tell which symbol in a file made the reference, so a stricter claim would be a guess dressed as precision.

**D5 — The scanner moves to its own module.** `check-dead-code.mjs` keeps the CLI contract (allowlist reason enforcement, exit codes, message text) and imports `scan()` from `dead-code-scan.mjs`. The split exists so the behaviour is importable by the Vitest lane; it is not an architectural restructure. `.mjs` files are already in the Vitest `include` glob (`scripts/verify-retry-policy.test.mjs` proves the pattern), so no config change is needed.

**D6 — `sliceWindow` and `sliceWithRange` merge into one exported `sliceByRange`.** These two private/public twins had byte-identical bodies; only the private one is called in production. The surviving name describes what it does (slice against a pre-derived range) and the derived-range contract stays explicit at the call site. `timestampWindowRange` remains the public entry point for computing that range, and both now have direct unit tests rather than one of them being tested through a helper the app never calls.

**D7 — Add a Rust test for the shared mapping.** `disk_kind_of` is trivial, but it is now the only place the two `Unknown` variants meet: sysinfo's `Unknown(isize)` carries a payload that must not be interpreted. A test pins SSD/HDD and both representative `Unknown` payloads.

## Risks / Trade-offs

- **A regex literal containing comment markers could produce a false finding.** Accepted (D2): it fails loudly, and no first-party source has one. The alternative — parsing full JS syntax — would add a dependency to a zero-dependency gate.
- **File-scoped chain attribution can miss a chain.** Accepted (D4): under-reporting is the safe direction, and the reported root still points a reader at the dead subtree.
- **The scanner is now two files instead of one.** Small cost, directly repaid by making the gate's correctness testable in-lane.

## Migration

None. No payload, schema, IPC, or persisted-state change. The gate's exit codes, output format, and allowlist contract are unchanged; only its verdicts become correct.
