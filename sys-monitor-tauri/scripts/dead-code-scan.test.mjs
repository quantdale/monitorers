import { describe, expect, it } from 'vitest';
import { stripComments, enumerateDeclarations, classifyDeclarations } from './dead-code-scan.mjs';

// The dead-code gate decides whether a real dead symbol is reported, so its
// scanner is pinned by red-capable tests rather than only by "today's tree
// happens to pass". Every fixture below is a defect the gate actually shipped
// with, or a construct that sits next to one and must not be broken by the fix.

describe('stripComments — comments are not references', () => {
  it('removes a line comment that names a symbol', () => {
    expect(stripComments('const a = 1; // calls helperOne()\nconst b = 2;', false)).toBe(
      'const a = 1; \nconst b = 2;',
    );
  });

  it('removes a block comment that names a symbol', () => {
    expect(stripComments('const a = 1;\n/* helperOne() */\nconst b = 2;', false)).toBe(
      'const a = 1;\n \nconst b = 2;',
    );
  });

  it('keeps the line count so reported line numbers stay real', () => {
    const source = 'line1\n/*\n * multi\n * line\n */\nline6';
    const stripped = stripComments(source, false);
    expect(stripped.split('\n')).toHaveLength(6);
  });
});

describe('stripComments — literals survive intact', () => {
  it('keeps a URL inside a string literal', () => {
    const source = "const base = 'http://127.0.0.1:5180';";
    expect(stripComments(source, false)).toBe(source);
  });

  it('keeps a URL inside a template literal', () => {
    const source = 'const u = `http://127.0.0.1:${port}/json/version`;';
    expect(stripComments(source, false)).toBe(source);
  });

  it('keeps an escaped-quote string containing a slash pair', () => {
    const source = "const s = 'it\\'s // not a comment';";
    // The escape is honoured, so the whole literal is copied verbatim.
    expect(stripComments(source, false)).toContain('not a comment');
  });

  it('keeps a lone JSX apostrophe from swallowing the rest of the line', () => {
    // `Couldn't` has no closing partner; treating it as a string opener would
    // delete the real code that follows on the same line.
    const source = "const el = <span>Couldn't load settings — {error}. Try restarting.</span>; // trailing";
    const stripped = stripComments(source, false);
    expect(stripped).toContain('Try restarting.');
    expect(stripped).not.toContain('trailing');
  });
});

describe('stripComments — Rust literal rules', () => {
  it('keeps a char literal holding a slash pair', () => {
    const source = "let c = '/'; let d = 'x'; // comment";
    expect(stripComments(source, true)).toContain("'/'");
    expect(stripComments(source, true)).toContain("'x'");
  });

  it('keeps an escaped char literal', () => {
    const source = "let n = '\\n'; // comment";
    expect(stripComments(source, true)).toContain("'\\n'");
  });

  it('keeps a lifetime instead of treating it as a string', () => {
    const source = "fn f() -> &'static str { \"x\" } // comment";
    expect(stripComments(source, true)).toContain("&'static str");
  });

  it('keeps a raw string that contains comment markers', () => {
    const source = 'let json = r#"{"a": 1 // not a comment"#; // real comment';
    expect(stripComments(source, true)).toContain('{"a": 1 // not a comment"#');
    expect(stripComments(source, true)).not.toContain('real comment');
  });
});

/** Build a synthetic two-file source set: one production module, one test. */
function sources(prod, test = '') {
  return {
    rustText: [],
    tsProdText: [{ file: '/app/src/mod.ts', text: stripComments(prod, false) }],
    tsTestText: [{ file: '/app/src/mod.test.ts', text: stripComments(test, false) }],
  };
}

describe('enumerateDeclarations + classifyDeclarations', () => {
  it('reports a production symbol that ONLY a comment mentions', () => {
    // The exact shipped defect: prose named `sliceWindow` and hid it.
    const set = sources('export function sliceWindow() {}\n// see sliceWindow\n');
    const declarations = enumerateDeclarations(set);
    const findings = classifyDeclarations(declarations, new Map());
    expect(findings.map((f) => [f.kind, f.sym.name])).toEqual([['dead', 'sliceWindow']]);
  });

  it('does not report a symbol that real code calls', () => {
    const set = sources('export function used() {}\nused();\n');
    expect(classifyDeclarations(enumerateDeclarations(set), new Map())).toEqual([]);
  });

  it('reports a symbol reached only from its own test as test-only', () => {
    const set = sources('export function seam() {}\n', "import { seam } from './mod';\nseam();\n");
    const findings = classifyDeclarations(enumerateDeclarations(set), new Map());
    expect(findings.map((f) => [f.kind, f.sym.name])).toEqual([['test-only', 'seam']]);
  });

  it('reports a dead chain together with its root', () => {
    // `root` is referenced only by `child`, and `child` is referenced by
    // nothing. Both are reported, so the dead subtree is fully visible and the
    // root (`child`, referenced nowhere) is identifiable rather than hidden.
    const set = sources('export function root() {}\nexport function child() { root(); }\n');
    const findings = classifyDeclarations(enumerateDeclarations(set), new Map());
    expect(findings.map((f) => [f.kind, f.sym.name]).sort()).toEqual([
      ['chain', 'root'],
      ['dead', 'child'],
    ]);
  });

  it('honours the allowlist by exact name and by substring', () => {
    const set = sources('export function seam() {}\nexport function other() {}\n');
    const allow = new Map([
      ['seam', 'a written reason long enough to satisfy the CLI length floor'],
      ['lib.rs pub use (library facade)', 'another written reason of sufficient length here'],
    ]);
    expect(
      classifyDeclarations(enumerateDeclarations(set), allow).map((f) => f.sym.name),
    ).toEqual(['other']);
  });

  it('ignores a JavaScript URL literal when counting references', () => {
    // A URL must not be stripped as a comment: doing so would have deleted the
    // string and could fabricate or destroy symbol references around it.
    const set = sources("export function helperOne() {}\nconst u = 'http://x/y';\n");
    expect(classifyDeclarations(enumerateDeclarations(set), new Map()).map((f) => f.sym.name)).toEqual([
      'helperOne',
    ]);
  });
});
