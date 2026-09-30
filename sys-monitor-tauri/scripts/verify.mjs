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
  // Cheapest check in the lane, and the one that fails fastest: three release
  // versions must agree, and every dependency version documented in the root
  // `.cursorrules` §1 table must mirror the committed Cargo.toml / package.json.
  run('release version + documentation consistency', process.execPath, ['scripts/check-version.mjs'], appRoot);
  // Cheap text scan, so it runs right after the doc check and before the two
  // audits / typecheck / tests / build. It lives here (rather than in the Rust
  // lane) because the CI `frontend` job is the fast, platform-agnostic PR gate
  // on ubuntu-latest, and the check itself is plain Node with no new dependency.
  run('dead-code check', process.execPath, ['scripts/check-dead-code.mjs'], appRoot);
  // Two audit scopes run here on purpose, and both are labelled so a reader
  // cannot mistake one for the other:
  //   - repository-root scope (repoRoot): the root workspace, which holds only
  //     `husky`. It cannot observe the application's transitive tree.
  //   - application scope (appRoot, i.e. sys-monitor-tauri): the tree that CI
  //     and .husky/pre-push actually install and audit.
  // The application scope is the AUTHORITATIVE result: runNpm throws on a
  // non-zero exit, so a high-severity advisory anywhere in the shipped test
  // toolchain fails this lane. The root scope stays as an intentional second
  // scope with its own lockfile, but it is never reported as "the" gate.
  runNpm('repository-root npm audit (root workspace)', ['audit', '--audit-level=high'], repoRoot);
  runNpm('application npm audit (sys-monitor-tauri)', ['audit', '--audit-level=high'], appRoot);
  runNpm('frontend typecheck', ['run', 'typecheck'], appRoot);
  // tsconfig.json excludes src/**/*.test.ts(x), so without this step no `tsc`
  // invocation in any lane has ever seen the Vitest sources. Placed right after
  // the production typecheck so a test-side type error fails fast, before the
  // slower unit-test run and the production build.
  runNpm('frontend test-source typecheck', ['run', 'typecheck:test'], appRoot);
  runNpm('frontend unit tests', ['test', '--', '--run'], appRoot);
  runNpm('frontend build', ['run', 'build'], appRoot);
}

function rust() {
  if (process.platform !== 'win32') {
    throw new Error('Rust/Tauri verification requires Windows; use the Windows CI gate.');
  }
  // `tauri::generate_context!()` validates frontendDist at compile time, so a
  // clean Rust job must produce the frontend bundle before any cargo target
  // (including unit-test binaries) is compiled.
  runNpm('frontend bundle for Rust/Tauri context', ['run', 'build'], appRoot);
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
  run('release version + documentation consistency', process.execPath, ['scripts/check-version.mjs'], appRoot);
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

function packaged() {
  if (process.platform !== 'win32') {
    throw new Error('Packaged-app qualification requires Windows.');
  }
  // Canonical packaged-runtime qualification: build the real executable,
  // then launch and assert it through the WebView2/CDP driver. Dispatch/tag
  // policy lane — expensive by design.
  tauri();
  runNpm('packaged-app qualification', ['run', 'verify:packaged'], appRoot);
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
  case 'packaged':
    packaged();
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
    throw new Error('usage: node scripts/verify.mjs <frontend|rust|version|e2e|sim|tauri|packaged|fast|full>');
}
