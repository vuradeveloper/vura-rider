#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Writes dist/build-commit.txt so the RUNNING server can print which commit it
// was built from. Elastic Beanstalk deploys a zip with NO .git directory, so
// `git rev-parse` on the instance can only answer "unknown" — that is exactly
// the "build unknown" boot line this file exists to kill.
//
// The value is the last commit that touched SERVER CODE (src, migrations,
// package/tsconfig) — deliberately NOT plain HEAD. A dist rebuild or a docs
// commit must not move it: otherwise committing dist would change the file,
// rebuilding would change it again, and the "rebuild → dist clean" gate could
// never hold. BUILD_COMMIT env overrides everything (deploy-time pinning).
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, "..");
const repoRoot = path.join(serverDir, ".."); // git pathspecs below are repo-root relative
const outFile = path.join(serverDir, "dist", "build-commit.txt");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  }).trim();
}

let commit = (process.env.BUILD_COMMIT || "").trim();
if (!commit) {
  try {
    // Last commit that changed the code this dist was compiled from.
    commit = git([
      "log",
      "-1",
      "--format=%h",
      "--",
      "server/src",
      "server/migrations",
      "server/package.json",
      "server/tsconfig.json",
    ]);
  } catch {
    commit = "";
  }
}
if (!commit) {
  try {
    commit = git(["rev-parse", "--short", "HEAD"]); // e.g. fresh clone edge cases
  } catch {
    commit = "";
  }
}
if (commit && !/^[0-9a-f]{4,40}$/i.test(commit)) commit = "";
if (!commit) commit = "unknown"; // never invent a hash

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, commit + "\n");
console.log(`[build-commit] ${commit} -> dist/build-commit.txt`);
