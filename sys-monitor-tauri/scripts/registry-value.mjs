import { execFileSync } from 'node:child_process';

/** A missing key/value is an answer; access denial or a failed query is not. */
export function queryRegistryValue(key, valueName, execute = execFileSync) {
  if (!key.startsWith('HKLM\\')) throw new Error(`Unsupported registry hive: ${key}`);
  // Values travel through the environment, never through PowerShell source.
  // .NET distinguishes a missing subkey (null) from access/security failures.
  const script = `
$ErrorActionPreference = 'Stop'
try {
  $policyKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($env:SYSMON_REGISTRY_SUBKEY)
  try {
    if ($null -eq $policyKey) { 'absent' }
    elseif ($policyKey.GetValueNames() -contains $env:SYSMON_REGISTRY_VALUE) { 'present' }
    else { 'absent' }
  } finally {
    if ($null -ne $policyKey) { $policyKey.Dispose() }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
  const output = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: 10_000,
    env: {
      ...process.env,
      SYSMON_REGISTRY_SUBKEY: key.slice(5),
      SYSMON_REGISTRY_VALUE: valueName,
    },
  }).trim();
  if (output === 'present') return true;
  if (output === 'absent') return false;
  throw new Error(`Registry query returned an invalid result: ${JSON.stringify(output)}`);
}
