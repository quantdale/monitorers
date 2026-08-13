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
