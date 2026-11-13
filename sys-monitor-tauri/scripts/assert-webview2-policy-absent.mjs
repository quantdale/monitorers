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
import { queryRegistryValue } from './registry-value.mjs';

const KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
const VALUE = '*';

if (process.platform !== 'win32') {
  console.log('assert-webview2-policy-absent: not Windows — nothing to assert');
  process.exit(0);
}

let present;
try {
  present = queryRegistryValue(KEY, VALUE);
} catch (error) {
  console.error(`assert-webview2-policy-absent: could not query the registry: ${String(error)}`);
  process.exit(1);
}

if (present) {
  console.error(`LEAKED: ${KEY}\\${VALUE} is STILL PRESENT after the run.`);
  console.error('Remove it with:');
  console.error(`  reg delete "${KEY}" /v ${VALUE} /f`);
  process.exit(1);
}

console.log(`assert-webview2-policy-absent: ${KEY}\\${VALUE} is absent`);
