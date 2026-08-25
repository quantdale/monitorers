// Release artifact integrity manifest.
//
// Scans a Tauri bundle output directory for MSI/NSIS installers and emits a
// JSON manifest recording application version, commit SHA, build timestamp,
// per-artifact filename/size/SHA-256/installer type, signing status, and the
// qualification result. CI uploads the manifest next to the installers so a
// release can be verified independently of the pipeline that produced it.
//
// Usage:
//   node scripts/installer-manifest.mjs --bundle <dir> --out <manifest.json> \
//        [--qualification-result passed|failed|not-run] [--note "..."]
//
// Signing status is recorded truthfully: this project has no code signing
// certificate today, so installers are unsigned; the structured field exists
// so a future signing step can flip it without redesigning the pipeline.
import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  openSync,
  readSync,
  closeSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { qualificationResult: 'not-run' };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--bundle') args.bundle = argv[++i];
    else if (key === '--out') args.out = argv[++i];
    else if (key === '--qualification-result') args.qualificationResult = argv[++i];
    else if (key === '--note') args.note = argv[++i];
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!args.bundle) throw new Error('usage: --bundle <dir> is required');
  if (!['passed', 'failed', 'not-run'].includes(args.qualificationResult)) {
    throw new Error(
      `--qualification-result must be passed|failed|not-run (got ${args.qualificationResult})`
    );
  }
  return args;
}

function sha256File(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    while (offset < size) {
      const bytes = readSync(fd, buffer, 0, buffer.length, offset);
      if (bytes <= 0) break;
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

function gitCommitSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim();
}

/** Installer type from extension: .msi → msi; NSIS ships as a setup .exe. */
function installerTypeFor(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.msi')) return 'msi';
  if (lower.endsWith('.exe')) return 'nsis';
  return null;
}

function collectInstallers(bundleDir, version) {
  const found = [];
  const versionToken = `_${version}_`;
  for (const kind of ['msi', 'nsis']) {
    const dir = join(bundleDir, kind);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      // Format not built in this run (e.g. MSI-only job): skip silently.
      continue;
    }
    for (const fileName of entries) {
      const type = installerTypeFor(fileName);
      if (!type) continue;
      // Only the CURRENT release version's artifacts belong in a release
      // manifest. Developer bundle directories accumulate installers from
      // older versions; hashing those would produce misleading evidence.
      if (!fileName.includes(versionToken)) continue;
      const path = join(dir, fileName);
      const size = statSync(path).size;
      if (size <= 0) throw new Error(`installer is empty: ${path}`);
      found.push({ path, fileName, type, sizeBytes: size });
    }
  }
  return found;
}

const args = parseArgs(process.argv);
const applicationVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version;
const installers = collectInstallers(args.bundle, applicationVersion);
if (installers.length === 0) {
  throw new Error(
    `no ${applicationVersion} MSI/NSIS installers found under ${args.bundle} (expected msi/ and nsis/ subdirectories)`
  );
}

const manifest = {
  schema_version: 1,
  applicationVersion,
  commitSha: gitCommitSha(),
  builtAtIso: new Date().toISOString(),
  signing: {
    status: 'unsigned',
    reason: 'no code signing certificate available for this project',
  },
  qualification: {
    result: args.qualificationResult,
    ...(args.note ? { note: args.note } : {}),
  },
  artifacts: installers.map(({ path, fileName, type, sizeBytes }) => ({
    file: fileName,
    path: relativePosix(args.bundle, path),
    installerType: type,
    sizeBytes,
    sha256: sha256File(path),
  })),
};

function relativePosix(from, to) {
  const rel = to.slice(from.length).replace(/\\/g, '/');
  return rel.startsWith('/') ? rel.slice(1) : rel;
}

if (!args.out) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`release manifest written: ${args.out} (${manifest.artifacts.length} installer(s))`);
}
