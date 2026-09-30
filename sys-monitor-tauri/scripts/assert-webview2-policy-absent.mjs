#!/usr/bin/env node
/**
 * CI/host guard: the packaged (real) simulation lane writes a MACHINE-WIDE
 * WebView2 policy value so an ELEVATED WebView2 host honours the remote
 * debugging switches. GitHub-hosted Windows runners run elevated, so on CI the
 * write succeeds and the value genuinely exists for the duration of the run.
 *
 * If teardown ever fails to remove it, every WebView2 host on that machine
 * keeps the debug switches — so a leaked value must FAIL THE JOB, not just
 * warn. This script is the post-teardown assertion for that.
 *
 * Usage: npm run assert:webview2-policy-absent
 * Exit 0 = value confirmed absent (or not applicable); exit 1 = still present.
 */
import { execFileSync } from 'node:child_process';

const KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const VALUE = '*';

if (process.platform !== 'win32') {
  console.log('assert-webview2-policy-absent: not Windows — nothing to assert');
  process.exit(0);
}

/**
 * Returns the `reg query` output when the value EXISTS, or null when it is
 * definitively absent. `reg query` exits 1 with "unable to find the specified
 * registry key or value" for a missing value — that is an answer, not a fault.
 * A spawn failure carries no numeric status and IS a fault.
 */
function queryValue() {
  try {
    return execFileSync('reg.exe', ['query', KEY, '/v', VALUE], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    if (typeof error.status === 'number') return null;
    throw error;
  }
}

let present = null;
try {
  present = queryValue();
} catch (error) {
  console.error(`assert-webview2-policy-absent: could not query the registry: ${String(error)}`);
  process.exit(1);
}

if (present !== null) {
  console.error(`LEAKED: ${KEY}\\${VALUE} is STILL PRESENT after the run.`);
  console.error(present);
  console.error('Remove it with:');
  console.error(`  reg delete "${KEY}" /v ${VALUE} /f`);
  process.exit(1);
}

console.log(`assert-webview2-policy-absent: ${KEY}\\${VALUE} is absent`);