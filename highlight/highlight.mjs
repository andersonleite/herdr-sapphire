// Colors lines of source files with Shiki (GitHub's dark theme) for Herdr mods, as a
// program: the mods' own JavaScript runtime is small and shared, and Shiki in it ran the
// window out of memory. Used by mods/sapphire-changes and mods/git-graph through
// `exec("node", ["<this file>", "<request>"])`.
//
//   node highlight.mjs '{"jobs":[{"lang":"tsx","sides":[{"file":"/abs/path","lines":[3,4]},{"ref":"HEAD","path":"src/a.tsx","cwd":"/repo","lines":[5]}]}]}'
//
// A job is one file's diff. A side's text comes from `file` (an absolute path) or from
// `git show ref:path` run in `cwd`. Each side answers with its requested lines, 1-based:
// { "3": { text, runs } } where runs is [{ text, color }], or null for a side that couldn't
// be read. Lines longer than LINE_MAX stay plain (runs null). The answer is one array per
// job. Several jobs in one run share the warmed-up grammars, so a commit's files cost little
// more than one. Nothing is written anywhere.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tokenizer, THEMES } from "./shiki.mjs";

const LINE_MAX = 2000, TEXT_MAX = 4_000_000, PIECE = 200;

function source(side) {
  try {
    if (side.file) return readFileSync(side.file, "utf8");
    if (side.ref && side.path && side.cwd) {
      return execFileSync("git", ["--no-optional-locks", "show", `${side.ref}:${side.path}`], { cwd: side.cwd, encoding: "utf8", maxBuffer: TEXT_MAX, stdio: ["ignore", "pipe", "ignore"] });
    }
  } catch {}
  return null;
}

function color(lang, text, wanted, theme) {
  if (text.includes("\0") || text.length > TEXT_MAX) return null;
  const lines = text.split("\n"), out = {};
  const last = Math.min(lines.length, Math.max(0, ...wanted));
  const tokenize = tokenizer(lang, theme);
  for (let at = 0; at < last; at += PIECE) {
    const piece = lines.slice(at, Math.min(last, at + PIECE));
    const colored = tokenize(piece.map((l) => (l.length > LINE_MAX ? "" : l)).join("\n"));
    piece.forEach((line, i) => {
      const n = at + i + 1;
      if (wanted.has(n)) out[n] = { text: line, runs: line.length > LINE_MAX ? null : colored[i] ?? null };
    });
  }
  return out;
}

const request = JSON.parse(process.argv[2] ?? "{}");
// `theme`: "dark" (default) or "light", GitHub's theme of that appearance.
const theme = THEMES[request.theme] ?? THEMES.dark;
const jobs = (request.jobs ?? [request]).map((job) => (job.sides ?? []).map((side) => {
  const wanted = new Set((side.lines ?? []).filter((n) => Number.isInteger(n) && n >= 1));
  if (!wanted.size) return {};
  const text = source(side);
  return text === null ? null : color(job.lang, text, wanted, theme);
}));
process.stdout.write(JSON.stringify(jobs));
