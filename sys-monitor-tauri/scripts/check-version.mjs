import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version;
const cargoText = readFileSync(join(appRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoMatch = cargoText.match(/^version\s*=\s*"([^"]+)"/m);
const tauriVersion = JSON.parse(readFileSync(join(appRoot, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;

if (!cargoMatch) throw new Error('Cargo.toml has no package version');
const versions = {
  'sys-monitor-tauri/package.json': packageVersion,
  'sys-monitor-tauri/src-tauri/Cargo.toml': cargoMatch[1],
  'sys-monitor-tauri/src-tauri/tauri.conf.json': tauriVersion,
};
const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  throw new Error(`release versions diverge: ${JSON.stringify(versions)}`);
}
console.log(`release version ${packageVersion} is consistent across frontend, Cargo, and Tauri config`);

// ---------------------------------------------------------------------------
// Documentation fidelity: the dependency table in the repository root
// `.cursorrules` must agree with the committed manifests. This exists because
// that table drifted through an entire dependency campaign: a documentation
// obligation with no enforcement mechanism is correct only by luck of timing.
// ---------------------------------------------------------------------------

const repoRoot = join(appRoot, '..');
const rulesPath = join(repoRoot, '.cursorrules');
let rulesText;
try {
  rulesText = readFileSync(rulesPath, 'utf8');
} catch {
  throw new Error(`documentation fidelity: ${rulesPath} is missing`);
}

/** Leading `major.minor` of a semver-ish string, so `^19.2.8` and `19` both yield `19.x`. */
function leadingMajorMinor(range) {
  const core = String(range).replace(/^[\^~>=<\s]*/, '');
  const parts = core.split(/[.\-+]/);
  if (parts.length === 0 || !/^\d+$/.test(parts[0])) return null;
  if (parts.length === 1) return `${parts[0]}.x`;
  return `${parts[0]}.${/^\d+$/.test(parts[1]) ? parts[1] : 'x'}`;
}

const rulesSectionEnd = rulesText.indexOf('\n## CI Readiness Gate');
const rulesTable = rulesSectionEnd === -1 ? rulesText : rulesText.slice(0, rulesSectionEnd);
if (!/## 1\. Project Overview & Core Stack/.test(rulesTable)) {
  throw new Error('documentation fidelity: `.cursorrules` §1 "Project Overview & Core Stack" section not found');
}

const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The declared range for a Cargo dependency (handles `x = "1"` and `x = { version = "1", … }`). */
function declaredCargoRange(name) {
  const manifest = new RegExp(`^\\s*${name}\\s*=\\s*(?:\\{[^}]*version\\s*=\\s*)?"([^"]+)"`, 'm');
  return cargoText.match(manifest)?.[1] ?? null;
}

/** The `"name": "range"` pair documented in the §1 table, if the row carries one. */
function documentedQuotedRange(name) {
  const match = rulesTable.match(new RegExp(`"${escapeRe(name)}"\\s*:\\s*"([^"]+)"`));
  return match ? match[1] : null;
}

/** The bare `` `name MAJOR.MINOR` `` mention documented in the §1 Backend row, if present. */
function documentedBareVersion(name) {
  // `{1,2}` (not `?`) so a three-component version like `nvapi-sys 0.1.3` is
  // consumed whole instead of matching only its `major.minor` prefix.
  const match = rulesTable.match(new RegExp('`' + escapeRe(name) + '[ =](\\d+(?:\\.\\d+){1,2})`'));
  return match ? match[1] : null;
}

const CARGO_PACKAGES = ['sysinfo', 'wmi', 'windows', 'nvapi-sys', 'nvml-wrapper'];
const FRONTEND_PACKAGES = ['react', 'typescript', 'vite', 'recharts', 'lucide-react'];

const mismatches = [];

for (const name of CARGO_PACKAGES) {
  const declared = declaredCargoRange(name);
  if (declared === null) {
    mismatches.push(`sys-monitor-tauri/src-tauri/Cargo.toml: ${name} is missing, but .cursorrules §1 documents it`);
    continue;
  }
  // A backend package is documented either as a bare `name 1.2` mention or as a
  // `"name": "range"` pair. Accept either form, but require at least one.
  const candidates = [documentedBareVersion(name), documentedQuotedRange(name)].filter((v) => v !== null);
  if (candidates.length === 0) {
    mismatches.push(`.cursorrules §1 Backend row: ${name} is declared as ${declared} in Cargo.toml but is not documented`);
    continue;
  }
  if (!candidates.some((documented) => leadingMajorMinor(documented) === leadingMajorMinor(declared))) {
    mismatches.push(
      `.cursorrules §1 Backend row: ${name} documented as ${candidates.join(' / ')}, Cargo.toml declares ${declared}`,
    );
  }
}

for (const name of FRONTEND_PACKAGES) {
  const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (declared === undefined) {
    mismatches.push(`sys-monitor-tauri/package.json: ${name} is documented in .cursorrules §1 but is not declared`);
    continue;
  }
  const documented = documentedQuotedRange(name);
  if (documented === null) {
    mismatches.push(
      `.cursorrules §1: ${name} is declared as ${declared} in package.json but is not documented in the core-stack table`,
    );
    continue;
  }
  if (leadingMajorMinor(documented) !== leadingMajorMinor(declared)) {
    mismatches.push(`.cursorrules §1: ${name} documented as ${documented}, package.json declares ${declared}`);
  }
}

if (mismatches.length > 0) {
  throw new Error(
    `documented dependency versions in .cursorrules §1 disagree with the committed manifests:\n  - ${mismatches.join('\n  - ')}\n` +
      'Fix the .cursorrules table (it must mirror Cargo.toml / package.json), not this script.',
  );
}

const checked = CARGO_PACKAGES.length + FRONTEND_PACKAGES.length;
console.log(`documentation fidelity: ${checked} .cursorrules §1 version claims match Cargo.toml / package.json`);
