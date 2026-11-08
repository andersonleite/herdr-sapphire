// Where a name is defined, found by text: every line with the word (`git grep -w -F` over the
// folder, plain `grep` outside a repo), then the ones shaped like a definition in common
// languages, ranked. No parser, no language server: same-named things in different scopes
// all show up, so the caller lists the hits when there is more than one. Step 1 of "go to
// definition"; a ctags or TypeScript backend can replace `definitions` later without
// changing the panel.
import { exec } from "herdr";

// Words that are never a definition target, whatever color they got.
export const SKIP = new Set("this super self new return await yield typeof instanceof void delete in of if else for while do switch case default break continue try catch finally throw import export from as const let var function class extends implements interface type enum namespace module declare async static public private protected readonly abstract override true false null undefined NaN Infinity def fn func struct trait impl pub mod use mut match loop where package go defer chan range nil end then elif elsif begin rescue ensure unless until lambda print echo local".split(" "));
// Before `name(`, these make it a call, not a definition.
const CALL_PREFIX = new Set("return await new yield throw if while for switch else case typeof delete void in of and or not".split(" "));
const EXCLUDE = ["node_modules", "dist", "build", "out", "target", "vendor", ".next", "coverage"];
const EXCLUDE_FILES = ["*.min.js", "*.map", "*.lock", "*.svg", "*.json", "*.md"];
const MAX_LINES = 20000; // lines with the word looked at, for a very common name
export const LIMIT = 12;

// The shapes a definition of `name` takes, for ranking the lines that have the word.
function shapes(name) {
  const r = name.replace(/\$/g, "\\$");
  return {
    // A: a keyword, then the name: `function foo`, `class Foo`, `def foo`, `fn foo`, `const foo`…
    a: new RegExp(`(?:function\\*?|class|interface|type|enum|namespace|def|defp|defmodule|defmacro|fn|func|fun|struct|trait|impl|val|var|let|const|static|mod|module|macro_rules!|proc|sub|typedef|object|data|newtype|let rec)\\s+${r}(?![\\w$])`),
    // Go method: `func (r *T) foo(`
    go: new RegExp(`func\\s+\\([^)]*\\)\\s*${r}\\s*\\(`),
    // B: the name given a function: `foo = (a) =>`, `foo: function`, `foo = async x =>`
    b: new RegExp(`(?<![\\w$.])${r}\\s*[:=]\\s*(?:async\\s+)?(?:function|\\(|[A-Za-z_$][\\w$]*\\s*=>)`),
    // C: a method or C-style definition at the start of a line: `[modifiers type] foo(`
    c: new RegExp(`^\\s*(?:[A-Za-z_$][\\w$<>,\\[\\] *&:]*\\s)?\\*?${r}\\s*(?:<[^>]*>)?\\s*\\(`),
    before: new RegExp(`([A-Za-z_$][\\w$]*)\\s+\\*?${r}\\s*\\(`),
  };
}

// Ranks a line: 0 best, null when it only looks like a call or a mention.
function rank(text, js, path) {
  // A type signature (`render: (i: number) => Element,` or a .d.ts) is a declaration at
  // best: listed, but after the real thing.
  if (/^\s*(\/\/|\/\*|\*\s|#\s|--\s)/.test(text)) return null; // a comment
  const typed = /\.d\.ts$/.test(path) ? 3 : 0;
  if (js.a.test(text) || js.go.test(text)) return typed;
  if (js.b.test(text)) return /=>\s*[A-Za-z_$][\w$.<>\[\]|&, ]*\s*[,;)]?\s*$/.test(text) && !/=>\s*[^,;]*[({]/.test(text) ? 3 : Math.max(1, typed);
  if (js.c.test(text)) {
    const prev = js.before.exec(text)?.[1];
    if (prev && CALL_PREFIX.has(prev)) return null;
    const t = text.trim();
    // A definition opens a block or continues on the next line; a call ends in `;` or `)`.
    if (/[;)]\s*$/.test(t) && !/\{/.test(t)) return null;
    return Math.max(2, typed);
  }
  return null;
}

// Lines with the word, as [path, line, text]. git first (fast, honors .gitignore).
async function lines(name, root, on) {
  const git = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "grep", "-n", "-z", "-I", "-w", "-F", "--untracked", "-e", name, "--", ".",
    ...EXCLUDE.map(d => `:(exclude)${d}`), ...EXCLUDE_FILES.map(f => `:(exclude)${f}`)], { cwd: root, on }).catch(() => null);
  if (git && (git.code === 0 || git.code === 1)) return git.stdout.split("\n", MAX_LINES).filter(Boolean).map(row => row.split("\0"));
  // -s -D skip: sockets and unreadable files are skipped quietly; code 2 with output is fine.
  const grep = await exec("grep", ["-rnIwFs", "-D", "skip", ...EXCLUDE.map(d => `--exclude-dir=${d}`), "--exclude-dir=.git", ...EXCLUDE_FILES.map(f => `--exclude=${f}`), "-e", name, "."], { cwd: root, on });
  if (grep.code > 1 && !grep.stdout) throw new Error(grep.stderr || "grep failed");
  return grep.stdout.split("\n", MAX_LINES).filter(Boolean).map(row => { const m = /^\.\/(.*?):(\d+):(.*)$/.exec(row); return m ? [m[1], m[2], m[3]] : null; }).filter(Boolean);
}

// { path, line, text, rank }[], best first, at most LIMIT, never the place clicked from.
export async function definitions(name, { root, on, from }) {
  const js = shapes(name), hits = [];
  for (const [path, line, text] of await lines(name, root, on)) {
    if (!path || !line || text === undefined || text.length > 2000) continue; // a minified line is no definition
    const n = Number(line), r = rank(text, js, path);
    if (r === null || (from && from.path === path && from.line === n)) continue;
    hits.push({ path, line: n, text: text.trim().slice(0, 160), rank: r });
  }
  const dir = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  const here = from ? dir(from.path) : "";
  hits.sort((x, y) => x.rank - y.rank || Number(dir(y.path) === here) - Number(dir(x.path) === here) || x.path.length - y.path.length || x.line - y.line);
  return hits.slice(0, LIMIT);
}
