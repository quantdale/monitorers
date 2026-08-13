import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appRoot, '..');
const rustRoot = join(appRoot, 'src-tauri');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const tauriCli = join(appRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

function run(label, command, args, cwd) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

function runNpm(label, args, cwd) {
  // Node 24 can reject a nested npm.cmd spawn with EINVAL on Windows. Invoke
  // npm's JavaScript entry point through the current Node executable instead;
  // this is equivalent to the shell command and keeps the canonical gate
  // usable from both npm scripts and CI.
  if (process.platform === 'win32') {
    run(label, process.execPath, [npmCli, ...args], cwd);
  } else {
    run(label, npm, args, cwd);
  }
}

function frontend() {
  run('release version consistency', process.execPath, ['scripts/check-version.mjs'], appRoot);
  runNpm('repository npm audit', ['audit', '--audit-level=high'], repoRoot);
  runNpm('frontend audit', ['audit', '--audit-level=high'], appRoot);
  runNpm('frontend typecheck', ['run', 'typecheck'], appRoot);
  runNpm('frontend unit tests', ['test', '--', '--run'], appRoot);
  runNpm('frontend build', ['run', 'build'], appRoot);
}

function rust() {
  if (process.platform !== 'win32') {
    throw new Error('Rust/Tauri verification requires Windows; use the Windows CI gate.');
  }
  run('Rust format', 'cargo', ['fmt', '--', '--check'], rustRoot);
  run('Rust tests', 'cargo', ['test', '--all-features'], rustRoot);
  run('Rust tests (default features)', 'cargo', ['test'], rustRoot);
  run('Rust tests (no default features)', 'cargo', ['test', '--no-default-features'], rustRoot);
  run('Rust tests (NVML only)', 'cargo', ['test', '--no-default-features', '--features', 'nvml'], rustRoot);
  run('Rust tests (NVAPI only)', 'cargo', ['test', '--no-default-features', '--features', 'nvapi'], rustRoot);
  run('Rust clippy', 'cargo', ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'], rustRoot);
  run('Rust audit', 'cargo', ['audit'], rustRoot);
}

function version() {
  run('release version consistency', process.execPath, ['scripts/check-version.mjs'], appRoot);
}

function e2e() {
  runNpm('E2E', ['run', 'e2e'], appRoot);
}

function simulation() {
  runNpm('simulation typecheck', ['run', 'sim:typecheck'], appRoot);
  runNpm('mock simulation matrix', ['run', 'sim'], appRoot);
}

function tauri() {
  if (process.platform !== 'win32') {
    throw new Error('Tauri release verification requires Windows.');
  }
  // Invoke the installed CLI entry point directly. Node 24 can report EINVAL
  // for a nested Windows `npm.cmd` shim, which would make this gate fail
  // before Tauri is ever launched.
  run('Tauri release executable', process.execPath, [tauriCli, 'build', '--no-bundle'], appRoot);
}

const mode = process.argv[2];
switch (mode) {
  case 'frontend':
    frontend();
    break;
  case 'version':
    version();
    break;
  case 'rust':
    rust();
    break;
  case 'e2e':
    e2e();
    break;
  case 'sim':
    simulation();
    break;
  case 'tauri':
    tauri();
    break;
  case 'fast':
    frontend();
    rust();
    break;
  case 'full':
    frontend();
    rust();
    e2e();
    simulation();
    tauri();
    break;
  default:
    throw new Error('usage: node scripts/verify.mjs <frontend|rust|version|e2e|sim|tauri|fast|full>');
}
