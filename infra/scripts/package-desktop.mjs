#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tauriRoot = join(repoRoot, 'apps', 'desktop', 'src-tauri');
const binariesDir = join(tauriRoot, 'binaries');

function parseArgs(argv) {
  const args = {
    target: undefined,
    ffmpegPath: '',
    ffprobePath: '',
    serverPath: '',
    bundles: undefined
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--target' && argv[i + 1]) {
      args.target = argv[++i];
      continue;
    }

    if (token === '--ffmpeg-path' && argv[i + 1]) {
      args.ffmpegPath = argv[++i];
      continue;
    }

    if (token === '--ffprobe-path' && argv[i + 1]) {
      args.ffprobePath = argv[++i];
      continue;
    }

    if (token === '--server-path' && argv[i + 1]) {
      args.serverPath = argv[++i];
      continue;
    }

    if (token === '--bundles' && argv[i + 1]) {
      args.bundles = argv[++i];
    }
  }

  return args;
}

function runCommand(command, commandArgs, errorMessage) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    throw new Error(`${errorMessage}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${errorMessage}: exit code ${result.status ?? 'null'}`);
  }
}

function defaultTargetForHost() {
  if (process.platform === 'win32') {
    return 'x86_64-pc-windows-msvc';
  }

  if (process.platform === 'darwin') {
    return 'aarch64-apple-darwin';
  }

  throw new Error('Unsupported host for desktop packaging. Use Windows or macOS.');
}

function resolveBinaryOnPath(name) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [name], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Could not find ${name} on PATH.`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function ensureExecutablePath(path, label) {
  if (!path || !existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function copySidecar(sourcePath, logicalName, targetTriple) {
  const extension = extname(sourcePath);
  const destination = join(binariesDir, `${logicalName}-${targetTriple}${extension}`);
  copyFileSync(sourcePath, destination);
  return destination;
}

function removeOldSidecars() {
  mkdirSync(binariesDir, { recursive: true });
  const prefixes = ['server-', 'ffmpeg-', 'ffprobe-'];

  for (const fileName of readdirSync(binariesDir)) {
    if (prefixes.some((prefix) => fileName.startsWith(prefix))) {
      rmSync(join(binariesDir, fileName), { force: true });
    }
  }
}

function detectServerPath(target, explicitPath) {
  if (explicitPath) {
    return explicitPath;
  }

  const isWindowsTarget = target.includes('windows');
  const fileName = isWindowsTarget ? 'videoshare-server.exe' : 'videoshare-server';
  return join(repoRoot, 'apps', 'server', 'release', fileName);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetTriple = args.target ?? defaultTargetForHost();
  const isWindowsTarget = targetTriple.includes('windows');

  console.log('Building web assets...');
  runCommand('npm', ['run', 'build', '--workspace', '@videoshare/web'], 'Web build failed');

  console.log('Building standalone server executable...');
  runCommand(
    'npm',
    ['run', 'build:release', '--workspace', '@videoshare/server'],
    'Server release build failed'
  );

  const serverPath = detectServerPath(targetTriple, args.serverPath);
  ensureExecutablePath(serverPath, 'Server executable');

  const ffmpegName = isWindowsTarget ? 'ffmpeg.exe' : 'ffmpeg';
  const ffprobeName = isWindowsTarget ? 'ffprobe.exe' : 'ffprobe';
  const ffmpegPath = args.ffmpegPath || resolveBinaryOnPath(ffmpegName);
  const ffprobePath = args.ffprobePath || resolveBinaryOnPath(ffprobeName);

  ensureExecutablePath(ffmpegPath, 'ffmpeg');
  ensureExecutablePath(ffprobePath, 'ffprobe');

  removeOldSidecars();

  const copiedServer = copySidecar(serverPath, 'server', targetTriple);
  const copiedFfmpeg = copySidecar(ffmpegPath, 'ffmpeg', targetTriple);
  const copiedFfprobe = copySidecar(ffprobePath, 'ffprobe', targetTriple);

  console.log(`Prepared server sidecar: ${copiedServer}`);
  console.log(`Prepared ffmpeg sidecar: ${copiedFfmpeg}`);
  console.log(`Prepared ffprobe sidecar: ${copiedFfprobe}`);

  const tauriArgs = ['run', 'tauri:build', '--workspace', '@videoshare/desktop', '--', '--target', targetTriple];
  if (args.bundles) {
    tauriArgs.push('--bundles', args.bundles);
  }

  console.log('Building Tauri installer/package...');
  runCommand('npm', tauriArgs, 'Desktop packaging failed');
}

main();
