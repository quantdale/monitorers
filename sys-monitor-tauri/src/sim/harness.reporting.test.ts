import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { writeJunit, writeTriageBundle } from '../../e2e/sim/reporting/reports';
import type { RunResult } from '../../e2e/sim/types';

function result(message: string): RunResult {
  return {
    opts: { seed: 42, runId: 'run', lane: 'mock', speed: 1, outDir: '.', deadlineMs: 0 },
    personaId: 'p',
    journeyId: 'j',
    driverKind: 'mock',
    startedAt: new Date(0).toISOString(),
    endedAt: new Date(1).toISOString(),
    durationMs: 1,
    passed: false,
    failureClass: 'app-defect',
    failureMessage: message,
    failingStep: 'assert',
    assertCount: 1,
    assertPassed: 0,
    seed: 42,
    diagnostics: [],
    artifacts: {
      outDir: '.',
      jsonl: '',
      junit: '',
      html: '',
      trace: null,
      video: null,
      screenshot: null,
      appStderr: null,
    },
  };
}

describe('simulation reporting', () => {
  it('writes well-formed JUnit for arbitrary failure text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monitorers-junit-'));
    const message = '<bad & "quoted" ]]> Ω';
    const path = writeJunit(dir, [result(message)]);
    const xml = readFileSync(path, 'utf8');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('failure')?.textContent).toContain(message);
  });

  it('copies triage artifacts without moving canonical files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monitorers-triage-'));
    const jsonl = join(dir, 'run.jsonl');
    const screenshot = join(dir, 'failure.png');
    writeFileSync(jsonl, 'canonical');
    writeFileSync(screenshot, 'png');
    const triage = writeTriageBundle({
      runDir: dir,
      jsonlPath: jsonl,
      screenshotPath: screenshot,
      tracePath: null,
      videoPath: null,
      appStderrPath: null,
      console: null,
      failureMessage: 'failed',
    });
    expect(existsSync(jsonl)).toBe(true);
    expect(existsSync(screenshot)).toBe(true);
    expect(existsSync(join(triage, 'run.jsonl'))).toBe(true);
    expect(existsSync(join(triage, 'failure.png'))).toBe(true);
  });
});
