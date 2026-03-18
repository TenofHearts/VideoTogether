import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(currentDirectory, '..');
const workspaceRoot = resolve(serverRoot, '../..');
const releaseRoot = resolve(serverRoot, 'release');
const seaRoot = resolve(releaseRoot, 'sea');
const webDistDirectory = resolve(workspaceRoot, 'apps', 'web', 'dist');
const bundlePath = resolve(seaRoot, 'server-bundle.cjs');
const blobPath = resolve(seaRoot, 'server.blob');
const configPath = resolve(seaRoot, 'sea-config.json');
const manifestPath = resolve(seaRoot, 'sea-assets.json');
const outputExecutablePath = resolve(releaseRoot, 'videoshare-server.exe');
const postjectExecutablePath = resolve(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'postject.cmd' : 'postject'
);
const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const nodeMajorVersion = process.versions.node.split('.')[0];

function assertExists(path, description) {
  if (!existsSync(path)) {
    throw new Error(`${description} not found: ${path}`);
  }
}

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function runCommand(command, args) {
  const spawnCommand =
    process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
      ? 'cmd.exe'
      : command;
  const spawnArgs =
    spawnCommand === 'cmd.exe'
      ? ['/d', '/s', '/c', command, ...args]
      : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });

  if (typeof result.stdout === 'string' && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }

  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'null'}${
        result.signal ? ` (signal: ${result.signal})` : ''
      }`
    );
  }
}

async function main() {
  assertExists(webDistDirectory, 'Web dist directory');
  assertExists(resolve(serverRoot, 'src', 'sea-entry.ts'), 'SEA entrypoint');
  assertExists(postjectExecutablePath, 'postject executable');

  rmSync(seaRoot, { force: true, recursive: true });
  mkdirSync(seaRoot, { recursive: true });
  mkdirSync(releaseRoot, { recursive: true });

  await build({
    bundle: true,
    entryPoints: [resolve(serverRoot, 'src', 'sea-entry.ts')],
    format: 'cjs',
    outfile: bundlePath,
    platform: 'node',
    target: [`node${nodeMajorVersion}`]
  });

  const assetFiles = collectFiles(webDistDirectory)
    .map((filePath) =>
      relative(webDistDirectory, filePath).replaceAll('\\', '/')
    )
    .sort();

  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        files: assetFiles,
        version: statSync(bundlePath).mtimeMs.toString()
      },
      null,
      2
    )
  );

  const assets = Object.fromEntries(
    assetFiles.map((relativePath) => [
      `web-dist/${relativePath}`,
      resolve(webDistDirectory, relativePath)
    ])
  );
  assets['sea-assets.json'] = manifestPath;

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: bundlePath,
        output: blobPath,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
        assets
      },
      null,
      2
    )
  );

  runCommand(process.execPath, ['--experimental-sea-config', configPath]);
  copyFileSync(process.execPath, outputExecutablePath);
  runCommand(postjectExecutablePath, [
    outputExecutablePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    sentinelFuse
  ]);
}

await main();
