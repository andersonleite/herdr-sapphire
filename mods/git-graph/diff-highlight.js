// GitHub's colors for diff rows (github-dark-default or github-light-default, by the
// appearance now: settings().dark). JSON is colored here; JavaScript and TypeScript go
// through Shiki in a separate program (~/.config/herdr-app/highlight/highlight.mjs, run
// with node), because the mods' JavaScript runtime is small and shared, and Shiki inside
// it ran the window out of memory. Kept identical in mods/sapphire-changes and
// mods/git-graph (a mod can't import from another mod's folder).
import { exec, appHome, settings } from "herdr";

const SHIKI = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx" };
const JSON_EXT = new Set(["json", "jsonc"]);
const JSON_SYNTAX = {
  dark: { key: "#7ee787", string: "#a5d6ff", literal: "#79c0ff", comment: "#8b949e", text: "#e6edf3" },
  light: { key: "#116329", string: "#0a3069", literal: "#0550ae", comment: "#6e7781", text: "#1f2328" },
};
/** "dark" or "light": the appearance the colors are for. Rows colored before a switch keep the old ones until recolored. */
export const appearance = () => (settings().dark !== false ? "dark" : "light");
const jsonColors = () => JSON_SYNTAX[appearance()];
const JSON_TOKEN = /("(?:[^"\\]|\\.)*"?)(?=(\s*:)?)|(\/\/.*|\/\*.*?(?:\*\/|$))|(-?\d[\w.+-]*|\b(?:true|false|null)\b)|(\s+)|([^\s"]+?)/g;

// One JSON line as runs of one color; neighbours of a color (and the spaces after them) are one run.
export function jsonRuns(line) {
  const runs = [], c = jsonColors();
  const add = (text, color) => {
    const last = runs[runs.length - 1];
    if (last && (last.color === color || !text.trim())) last.text += text;
    else runs.push({ text, color });
  };
  for (const m of line.matchAll(JSON_TOKEN)) {
    if (m[1] !== undefined) add(m[1], m[2] !== undefined ? c.key : c.string);
    else if (m[3] !== undefined) add(m[3], c.comment);
    else if (m[4] !== undefined) add(m[4], c.literal);
    else add(m[0], c.text);
  }
  return runs;
}

const ext = (path) => path.split(".").pop().toLowerCase();
/** Whether `colorize` has colors for this file. */
export const highlightable = (path) => JSON_EXT.has(ext(path)) || ext(path) in SHIKI;

/**
 * Colors diff rows ({ kind: "+" | "-" | " " | "@" | "", number, text }) in place, setting
 * `runs` ([{ text, color }]) on each code row, and resolves true when any row got colors
 * (the caller redraws then). Never rejects.
 *
 * A diff is two files interleaved: the new one (context and added rows, `number` is its
 * line) and the old one (removed rows). `source` says where each is: `newRef` is
 * "worktree" (the file on disk under `root`) or a git ref, `oldRef` a git ref, either null
 * when that side doesn't exist. Each side is colored from its first line, so a row looks
 * as it does in the whole file (a hunk that opens inside JSX or a comment included). Only
 * this machine has the program, so `on` (another machine) gets no colors.
 */
export async function colorize(path, rows, source) {
  return (await colorizeMany([{ path, rows, source }]))[0];
}

/**
 * `colorize` for several diffs of one repository at once ([{ path, rows, source }], the same
 * `root` and `on` in every source): one run of the program, whose warmed-up grammars make the
 * files after the first cheap. Resolves one boolean per diff. Never rejects.
 */
export async function colorizeMany(diffs) {
  const done = diffs.map(() => false), jobs = [];
  diffs.forEach(({ path, rows, source: { root, on, newRef, oldRef } }, i) => {
    if (JSON_EXT.has(ext(path))) {
      for (const row of rows) if (row.kind === "+" || row.kind === "-" || row.kind === " ") row.runs = jsonRuns(row.text);
      done[i] = true;
      return;
    }
    const lang = SHIKI[ext(path)];
    if (!lang || on || !root) return;
    const news = rows.filter((r) => r.kind === "+" || r.kind === " "), olds = rows.filter((r) => r.kind === "-");
    const side = (ref, mine) => {
      const lines = [...new Set(mine.map((r) => r.number).filter((n) => n >= 1))];
      if (!ref || !lines.length) return { lines: [] };
      return ref === "worktree" ? { file: `${root}/${path}`, lines } : { ref, path, cwd: root, lines };
    };
    jobs.push({ i, root, news, olds, job: { lang, sides: [side(newRef, news), side(oldRef, olds)] } });
  });
  if (!jobs.length) return done;
  let answer;
  try {
    const r = await exec("node", [`${appHome()}/highlight/highlight.mjs`, JSON.stringify({ theme: appearance(), jobs: jobs.map((j) => j.job) })], { cwd: jobs[0].root });
    if (r.code !== 0) return done;
    answer = JSON.parse(r.stdout);
  } catch { return done; }
  jobs.forEach(({ i, news, olds }, k) => {
    const take = (mine, got) => {
      if (!got) return;
      for (const row of mine) {
        const line = got[row.number];
        // The diff's text must still be the file's: a file edited since, or a truncated row, stays plain.
        if (line?.runs && (line.text === row.text || (line.text === "" && row.text === " "))) { row.runs = line.runs; done[i] = true; }
      }
    };
    take(news, answer?.[k]?.[0]); take(olds, answer?.[k]?.[1]);
  });
  return done;
}
