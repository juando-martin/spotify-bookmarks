#!/usr/bin/env node
// Copyright (c) 2026 Juan D. Martin
// Bump the deploy version in the two places that must always agree:
//   js/version.js  -> APP_VERSION
//   sw.js          -> CACHE_NAME ("playlist-resume-shell-vN", or "...-vN-bM"
//                     for a beta build while iterating on a fix)
//
//   npm run bump           # plain release: current + 1 (drops any -bM)
//                          # mid-beta (current is N-bM): next beta, N-b(M+1)
//   npm run bump -- beta   # start (N -> N-b1) or continue (N-bM -> N-b(M+1))
//                          # a beta series without touching the base number
//   npm run bump -- 30     # set an exact plain release, drops any beta suffix
//   npm run bump -- 30-b2  # set an exact beta build explicitly

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = join(root, "js/version.js");
const swFile = join(root, "sw.js");

const VERSION_PATTERN = "\\d+(?:-b\\d+)?"; // "30" or "30-b2"

const versionSrc = readFileSync(versionFile, "utf8");
const current = versionSrc.match(new RegExp(`APP_VERSION\\s*=\\s*"(${VERSION_PATTERN})"`))?.[1];
if (current === undefined) {
  console.error(`Couldn't find APP_VERSION in ${versionFile}`);
  process.exit(1);
}
const [currentBase, currentBeta] = current.split("-b");

const arg = process.argv[2];
let next;
if (arg === undefined) {
  // Mid-beta -> next beta build; a plain release -> next release, same as always.
  next = currentBeta ? `${currentBase}-b${Number(currentBeta) + 1}` : String(Number(currentBase) + 1);
} else if (arg === "beta") {
  next = `${currentBase}-b${currentBeta ? Number(currentBeta) + 1 : 1}`;
} else if (new RegExp(`^${VERSION_PATTERN}$`).test(arg) && Number(arg.split("-b")[0]) > 0) {
  next = arg;
} else {
  console.error(`Bad version: "${arg}"`);
  process.exit(1);
}

writeFileSync(
  versionFile,
  versionSrc.replace(new RegExp(`(APP_VERSION\\s*=\\s*")${VERSION_PATTERN}(")`), `$1${next}$2`),
);

const swSrc = readFileSync(swFile, "utf8");
if (!new RegExp(`playlist-resume-shell-v${VERSION_PATTERN}`).test(swSrc)) {
  console.error(`Couldn't find the CACHE_NAME version in ${swFile}`);
  process.exit(1);
}
writeFileSync(
  swFile,
  swSrc.replace(new RegExp(`(playlist-resume-shell-v)${VERSION_PATTERN}`), `$1${next}`),
);

console.log(`Bumped ${current} -> ${next}  (js/version.js + sw.js)`);
