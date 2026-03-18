/*
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';

import { startServer } from './start-server.js';

type SeaAssetManifest = {
  files: string[];
  version: string;
};

const assetManifestKey = 'sea-assets.json';
const assetRootKey = 'web-dist';
const manifestMarkerName = '.sea-manifest.json';

function getWebDistOutputDirectory(): string {
  return process.env.WEB_DIST_DIR && process.env.WEB_DIST_DIR.length > 0
    ? process.env.WEB_DIST_DIR
    : resolve(process.cwd(), 'web-dist');
}

function extractBundledWebDist(): void {
  if (!isSea()) {
    return;
  }

  const webDistDirectory = getWebDistOutputDirectory();
  const manifestRaw = getAsset(assetManifestKey, 'utf8');

  if (!manifestRaw) {
    throw new Error('SEA asset manifest is missing.');
  }

  const manifest = JSON.parse(manifestRaw) as SeaAssetManifest;
  const manifestMarkerPath = join(webDistDirectory, manifestMarkerName);
  let shouldExtract = true;

  try {
    shouldExtract = readFileSync(manifestMarkerPath, 'utf8') !== manifestRaw;
  } catch {
    shouldExtract = true;
  }

  if (!shouldExtract) {
    process.env.WEB_DIST_DIR = webDistDirectory;
    return;
  }

  rmSync(webDistDirectory, { force: true, recursive: true });
  mkdirSync(webDistDirectory, { recursive: true });

  for (const relativeAssetPath of manifest.files) {
    const assetKey = `${assetRootKey}/${relativeAssetPath}`;
    const asset = getAsset(assetKey);

    if (!asset) {
      throw new Error(`SEA asset is missing: ${assetKey}`);
    }

    const destinationPath = join(webDistDirectory, relativeAssetPath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, Buffer.from(asset));
  }

  writeFileSync(manifestMarkerPath, manifestRaw, 'utf8');
  process.env.WEB_DIST_DIR = webDistDirectory;
}

async function main() {
  extractBundledWebDist();
  await startServer();
}

void main();
