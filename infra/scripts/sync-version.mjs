import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

// Read the new version from root package.json (already updated by npm version)
const rootPkgContent = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
const rootPkg = JSON.parse(rootPkgContent);
const version = rootPkg.version;

console.log(`Syncing desktop version to ${version}...`);

const updateJson = (relPath) => {
    const fullPath = path.join(rootDir, relPath);
    if (fs.existsSync(fullPath)) {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        data.version = version;
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n');
        console.log(`Updated ${relPath}`);
    }
};

updateJson('apps/desktop/package.json');
updateJson('apps/desktop/src-tauri/tauri.conf.json');

const cargoPath = path.join(rootDir, 'apps/desktop/src-tauri/Cargo.toml');
if (fs.existsSync(cargoPath)) {
    let cargo = fs.readFileSync(cargoPath, 'utf8');
    cargo = cargo.replace(/(^name\s*=\s*"VideoTogether"\r?\nversion\s*=\s*)"[^"]+"/m, `$1"${version}"`);
    fs.writeFileSync(cargoPath, cargo);
    console.log('Updated apps/desktop/src-tauri/Cargo.toml');
}
