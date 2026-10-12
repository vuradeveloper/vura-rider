import { execSync } from "child_process";
import { readFileSync } from "fs";
import crypto from "crypto";

const norm = (s) => s.replace(/\r\n/g, "\n");
const extract = (s, re) => {
  const m = s.match(re);
  if (!m) throw new Error("no match: " + re);
  return m[0];
};
const h = (x) => crypto.createHash("sha256").update(x).digest("hex").slice(0, 16);
const show = (rev) => norm(execSync(`git show ${rev}:server/src/services/dispatch.ts`, { encoding: "utf8", maxBuffer: 1e8 }));

const head = norm(readFileSync("server/src/services/dispatch.ts", "utf8"));
const RENAMED = /async function findCandidatesHaversine\([\s\S]*?\n\}/;
const ORIGINAL = /async function findCandidates\([\s\S]*?\n\}/;

// Baseline 1: 0010bb0 (pre-Module-1 proven body, already renamed)
const a = extract(show("0010bb0"), RENAMED);
const b = extract(head, RENAMED);
console.log("[0010bb0 vs HEAD]", a.length, b.length, h(a), h(b), "IDENTICAL=" + (a === b));

// Baseline 2: main f1d5859 (original pre-rename function), name normalized
const c = extract(show("f1d5859"), ORIGINAL).replace(/findCandidates\b/g, "findCandidatesHaversine");
console.log("[main(f1d5859) vs HEAD]", c.length, b.length, h(c), h(b), "IDENTICAL=" + (c === b));

