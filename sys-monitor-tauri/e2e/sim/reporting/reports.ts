/**
 * Artifact generation: JSONL action/event log, JUnit XML + HTML journey
 * reports, and failure-triage bundles (tasks 4.1–4.4).
 *
 * The JSONL log carries the run header (seed, persona, journey, driver) and
 * ordered actions/assertions with drawn timings — the `reproduce from seed`
 * contract. JUnit is consumed by CI; HTML is for humans. The triage bundle
 * groups the failure slice (log tail, screenshot, trace/video paths, console
 * capture, app stderr) under the run directory.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { JsonLog, RunResult } from '../types';

export interface ConsoleCapture {
  messages: { type: string; text: string }[];
  pageErrors: string[];
}

export function writeJsonl(runDir: string, lines: JsonLog[]): string {
  const path = join(runDir, 'run.jsonl');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return path;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function writeJunit(runDir: string, results: RunResult[]): string {
  const path = join(runDir, 'junit.xml');
  mkdirSync(runDir, { recursive: true });
  const suites = results
    .map((r) => {
      const testName = `${r.journeyId} [${r.personaId}] (${r.driverKind})`;
      const time = (r.durationMs / 1000).toFixed(3);
      const failure = r.passed ? '' : `\n    <failure message="${xmlEscape(r.failureMessage ?? 'failed')}"><![CDATA[${xmlEscape(
        `journey=${r.journeyId}\npersona=${r.personaId}\ndriver=${r.driverKind}\nseed=${r.seed}\nfailingStep=${r.failingStep ?? 'unknown'}
${r.failureMessage ?? ''}`
      )}]]></failure>`;
      return `  <testsuite name="${xmlEscape(testName)}" tests="1" failures="${r.passed ? 0 : 1}" time="${time}">
    <testcase name="${xmlEscape(testName)}" time="${time}">${failure}
    </testcase>
  </testsuite>`;
    })
    .join('\n');
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${results.length}" failures="${results.filter((r) => !r.passed).length}">\n${suites}\n</testsuites>\n`,
    'utf8'
  );
  return path;
}

export function writeHtml(runDir: string, results: RunResult[]): string {
  const path = join(runDir, 'index.html');
  mkdirSync(runDir, { recursive: true });
  const rows = results
    .map((r) => {
      const color = r.passed ? '#2ecc71' : '#e74c3c';
      return `<tr>
        <td>${r.journeyId}</td>
        <td>${r.personaId}</td>
        <td>${r.driverKind}</td>
        <td style="color:${color};font-weight:600">${r.passed ? 'PASS' : 'FAIL'}</td>
        <td>${r.failureClass}</td>
        <td>${(r.durationMs / 1000).toFixed(1)}s</td>
        <td>${r.assertPassed}/${r.assertCount}</td>
        <td>seed=${r.seed}</td>
        <td style="max-width:360px">${xmlEscape(r.failureMessage ?? '')}</td>
      </tr>`;
    })
    .join('\n');
  writeFileSync(
    path,
    `<!doctype html><html><head><meta charset="utf-8"><title>Simulation run report</title>
<style>body{font-family:system-ui;margin:24px;background:#111;color:#ddd}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px 10px;font-size:13px;text-align:left}th{background:#222}</style>
</head><body><h2>Simulation run — ${results.length} journey(s)</h2><table><tr><th>journey</th><th>persona</th><th>driver</th><th>result</th><th>class</th><th>duration</th><th>asserts</th><th>seed</th><th>message</th></tr>\n${rows}\n</table></body></html>\n`,
    'utf8'
  );
  return path;
}

/** Classifies a failure: app defect vs harness defect vs undrivable. */
export function classifyFailure(
  err: unknown,
  isUndrivableHint: boolean
): { failureClass: RunResult['failureClass']; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (isUndrivableHint || /\b(not supported|undrivable|no .*driver|does not support)\b/i.test(message)) {
    return { failureClass: 'undrivable', message };
  }
  // Harness defects: infra-level failures (CDP attach, spawn, timeout of
  // driver bring-up, Playwright fixture errors).
  if (
    /RealAppDriver|MockHarnessDriver|connectOverCDP|failed to spawn|CDP endpoint|Timeout \d+ms exceeded.*(waitForSelector|goto)/i.test(
      message
    )
  ) {
    return { failureClass: 'harness-defect', message };
  }
  return { failureClass: 'app-defect', message };
}

export interface TriageBundleInput {
  runDir: string;
  jsonlPath: string;
  screenshotPath: string | null;
  tracePath: string | null;
  videoPath: string | null;
  appStderrPath: string | null;
  console: ConsoleCapture | null;
  failureMessage: string;
}

/** Writes a triage bundle manifest + copies key artifacts under `triage/`. */
export function writeTriageBundle(input: TriageBundleInput): string {
  const triageDir = join(input.runDir, 'triage');
  mkdirSync(triageDir, { recursive: true });

  // Copy artifacts into the triage dir so the bundle is self-contained.
  const copied: string[] = [];
  const copyIf = (src: string | null): string | null => {
    if (!src || !existsSync(src)) return null;
    const dest = join(triageDir, basename(src));
    try {
      readFileSync(src); // existence check
      renameSync(src, dest);
      copied.push(dest);
      return dest;
    } catch {
      return null;
    }
  };
  const screenshot = copyIf(input.screenshotPath);
  const trace = copyIf(input.tracePath);
  const video = copyIf(input.videoPath);
  const appStderr = copyIf(input.appStderrPath);
  const jsonl = copyIf(input.jsonlPath);

  const consoleLines = input.console
    ? input.console.messages.map((m) => `[${m.type}] ${m.text}`).join('\n') +
      (input.console.pageErrors.length ? '\n--- page errors ---\n' + input.console.pageErrors.join('\n') : '')
    : '(no console capture)';

  const manifest = [
    '# Failure triage bundle',
    `failureMessage: ${input.failureMessage}`,
    `jsonl: ${jsonl ?? '(none)'}`,
    `screenshot: ${screenshot ?? '(none)'}`,
    `trace: ${trace ?? '(none)'}`,
    `video: ${video ?? '(none)'}`,
    `appStderr: ${appStderr ?? '(none)'}`,
    '',
    '## console / page errors',
    consoleLines,
    '',
    '## reproduce',
    `run the failing journey with the logged seed (see run.jsonl header).`,
  ].join('\n');
  writeFileSync(join(triageDir, 'TRIAGE.md'), manifest + '\n', 'utf8');
  copied.push(join(triageDir, 'TRIAGE.md'));

  void jsonl;
  return triageDir;
}

/** A lightweight JSONL emitter used by the runner to surface progress. */
export function readTextLines(path: string, tail = 10): string[] {
  try {
    if (!existsSync(path)) return [];
    const content = readFileSync(path, 'utf8').trim().split('\n');
    return content.slice(-tail);
  } catch {
    return [];
  }
}