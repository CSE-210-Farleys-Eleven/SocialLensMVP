#!/usr/bin/env node
/**
 * Validates a release version before tagging. Usage: node scripts/check-release-version.mjs 1.2.3
 * Checks: strict semver (no "v" prefix), equals package.json "version", tag not already taken,
 * and greater than the highest existing vX.Y.Z tag. Exits 1 with a reason on failure.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const version = process.argv[2] ?? '';
const fail = (msg) => {
  console.error(`Release check failed: ${msg}`);
  process.exit(1);
};

const m = SEMVER.exec(version);
if (!m) fail(`"${version}" is not a semantic version like 1.2.3 (no leading "v").`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (pkg !== version) fail(`package.json says ${pkg}, release is ${version}. Bump package.json in a PR first (npm version ${version} --no-git-tag-version).`);

const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
if (tags.includes(`v${version}`)) fail(`tag v${version} already exists.`);

const core = (v) => v.replace(/^v/, '').split('-')[0].split('.').map(Number);
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const highest = tags.map(core).sort(cmp).pop();
if (highest && cmp(core(version), highest) < 0) fail(`${version} is lower than the latest release ${highest.join('.')}.`);

console.log(`Release ${version} OK.`);
