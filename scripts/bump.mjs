#!/usr/bin/env node
// Bump the deploy version in the two places that must always agree:
//   js/version.js  -> APP_VERSION
//   sw.js          -> CACHE_NAME ("playlist-resume-shell-vN")
//
//   npm run bump          # current + 1
//   npm run bump -- 30    # set explicitly

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = join(root, "js/version.js");
const swFile = join(root, "sw.js");

const versionSrc = readFileSync(versionFile, "utf8");
const current = versionSrc.match(/APP_VERSION\s*=\s*"(\d+)"/)?.[1];
if (current === undefined) {
  console.error(`Couldn't find APP_VERSION in ${versionFile}`);
  process.exit(1);
}

const arg = process.argv[2];
const next = arg === undefined ? Number(current) + 1 : Number(arg);
if (!Number.isInteger(next) || next <= 0) {
  console.error(`Bad version: "${arg}"`);
  process.exit(1);
}

writeFileSync(
  versionFile,
  versionSrc.replace(/(APP_VERSION\s*=\s*")\d+(")/, `$1${next}$2`),
);

const swSrc = readFileSync(swFile, "utf8");
if (!/playlist-resume-shell-v\d+/.test(swSrc)) {
  console.error(`Couldn't find the CACHE_NAME version in ${swFile}`);
  process.exit(1);
}
writeFileSync(swFile, swSrc.replace(/(playlist-resume-shell-v)\d+/, `$1${next}`));

console.log(`Bumped ${current} -> ${next}  (js/version.js + sw.js)`);
