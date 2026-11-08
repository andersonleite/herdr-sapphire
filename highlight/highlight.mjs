// Colors lines of source files with Shiki (GitHub's dark theme) for Herdr mods, as a
// program: the mods' own JavaScript runtime is small and shared, and Shiki in it ran the
// window out of memory. Used by mods/sapphire-changes, mods/git-graph and mods/sapphire-files through
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
//
// A side with `all: true` (mods/sapphire-files, a whole file) answers compactly instead:
// { colors: ["#…", …], lines: [ [[text, colorIndex], …] | null, … ] }, the text normalized
// as the panel shows it (CRLF → LF, tab → two spaces, no final newline), so the panel can
// check each line still matches before coloring it.
import { readFileSync, statSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

const LINE_MAX = 2000, TEXT_MAX = 4_000_000;
// Shiki is imported only when something has to be colored: a cached whole file (below)
// answers without it, in the time node takes to start.
const THEMES = { dark: "github-dark-default", light: "github-light-default" };
let shiki;
async function loadShiki() { shiki ??= await import("./shiki.mjs"); }
const tokenizer = (lang, theme) => shiki.tokenizer(lang, theme);

// Whole files colored before are kept by path, size, modification time, language and
// theme, so a file opens again at once; the first coloring of a process warms the
// grammars (about half a second) and is what this saves. Outside the Herdr folder.
const CACHE = `${homedir()}/.cache/herdr-sapphire/highlight`, CACHE_MAX = 600;
const cacheKey = (side, lang, theme) => {
  try { const st = statSync(side.file); return createHash("sha1").update(`${side.file}\0${st.size}\0${st.mtimeMs}\0${lang}\0${theme}`).digest("hex"); }
  catch { return null; }
};
const cached = (key) => { try { return key ? JSON.parse(readFileSync(`${CACHE}/${key}.json`, "utf8")) : null; } catch { return null; } };
function remember(key, answer) {
  if (!key || !answer) return;
  try {
    mkdirSync(CACHE, { recursive: true });
    const tmp = `${CACHE}/${key}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(answer)); renameSync(tmp, `${CACHE}/${key}.json`);
    const all = readdirSync(CACHE).filter((f) => f.endsWith(".json"));
    if (all.length > CACHE_MAX) {
      all.map((f) => ({ f, t: statSync(`${CACHE}/${f}`).mtimeMs })).sort((a, b) => a.t - b.t).slice(0, all.length - CACHE_MAX + 100)
        .forEach(({ f }) => { try { unlinkSync(`${CACHE}/${f}`); } catch {} });
    }
  } catch {}
}

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
  // One call up to the last wanted line (piece by piece costs about four times as much).
  const colored = tokenizer(lang, theme)(lines.slice(0, last).map((l) => (l.length > LINE_MAX ? "" : l)).join("\n"));
  for (let i = 0; i < last; i++) {
    const n = i + 1, line = lines[i];
    if (wanted.has(n)) out[n] = { text: line, runs: line.length > LINE_MAX ? null : colored[i] ?? null };
  }
  return out;
}

const request = JSON.parse(process.argv[2] ?? "{}");
// `theme`: "dark" (default) or "light", GitHub's theme of that appearance.
const theme = THEMES[request.theme] ?? THEMES.dark;
function colorAll(lang, raw, theme) {
  if (raw.includes("\0") || raw.length > TEXT_MAX) return null;
  const text = raw.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/\n$/, "");
  const lines = text.split("\n"), colors = [], index = new Map(), out = new Array(lines.length).fill(null);
  // One call for the whole file: calling the tokenizer piece by piece costs about four
  // times as much (each call re-enters the grammar), and a file this size fits with ease.
  const colored = tokenizer(lang, theme)(lines.map((l) => (l.length > LINE_MAX ? "" : l)).join("\n"));
  lines.forEach((line, i) => {
    if (line.length > LINE_MAX || !colored[i]) return;
    out[i] = colored[i].map(({ text, color }) => {
      let c = index.get(color);
      if (c === undefined) { c = colors.length; colors.push(color); index.set(color, c); }
      return [text, c];
    });
  });
  return { colors, lines: out };
}

const work = (request.jobs ?? [request]).map((job) => (job.sides ?? []).map((side) => {
  if (side.all && side.file) {
    const key = cacheKey(side, job.lang, theme), hit = cached(key);
    if (hit) return () => hit;
    return async () => { const text = source(side); if (text === null) return null; await loadShiki(); const answer = colorAll(job.lang, text, theme); remember(key, answer); return answer; };
  }
  return async () => {
    const wanted = new Set((side.lines ?? []).filter((n) => Number.isInteger(n) && n >= 1));
    if (!wanted.size) return {};
    const text = source(side);
    if (text === null) return null;
    await loadShiki();
    return color(job.lang, text, wanted, theme);
  };
}));
const jobs = [];
for (const sides of work) { const out = []; for (const side of sides) out.push(await side()); jobs.push(out); }
process.stdout.write(JSON.stringify(jobs));
