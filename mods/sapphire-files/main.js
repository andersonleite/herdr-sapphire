// A lazy file browser for the focused pane's folder, with bounded read-only previews and a
// fuzzy search over every file in it (./fuzzy.js).
// Clone of Herdr's `files`: while a file is open, the tree stays docked on the right
// of the preview. The header's panel button hides or shows it (remembered), and the
// line between them drags to resize the tree (remembered; double-click for the default).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState, Scrollbar, TextView, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window } from "herdr";
import { tokenizer } from "./shiki.js";
import { index, search } from "./fuzzy.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const SEARCH_FILES = 20000, SEARCH_HITS = 200; // files the search knows, results it lists
const MARKDOWN = new Set(["md", "markdown", "mdx"]); // these open rendered, or as source: the header's two buttons
// GitHub's themes (github-dark-default / github-light-default), on the token kinds the
// built-in editor colors. Which one: the appearance now (settings().dark), read when drawing
// so a theme switch recolors without a reload.
const GITHUB_SYNTAX = {
  dark: {
    comment: "#8b949e", keyword: "#ff7b72", operator: "#ff7b72", string: "#a5d6ff", "string.escape": "#ff7b72",
    number: "#79c0ff", constant: "#79c0ff", boolean: "#79c0ff", function: "#d2a8ff", type: "#ffa657",
    variable: "#e6edf3", punctuation: "#e6edf3",
  },
  light: {
    comment: "#6e7781", keyword: "#cf222e", operator: "#cf222e", string: "#0a3069", "string.escape": "#cf222e",
    number: "#0550ae", constant: "#0550ae", boolean: "#0550ae", function: "#8250df", type: "#953800",
    variable: "#1f2328", punctuation: "#1f2328",
  },
};
const isDark = () => settings().dark !== false;
const syntax = () => GITHUB_SYNTAX[isDark() ? "dark" : "light"];
const SHIKI_THEME = () => (isDark() ? "github-dark-default" : "github-light-default");
// JSON and the JavaScript family are drawn here instead of in the editor, one row per line,
// only the visible ones built. JSON: the editor colors a key like any other string, and
// GitHub doesn't (keys green, values blue). JS/TS/JSX/TSX: the editor has no TypeScript
// grammar and no color for tags, so Shiki tokenizes them (./shiki.js, built from
// shiki.entry.mjs) with GitHub's own grammars and dark theme.
const SHIKI = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx" };
// Shiki runs on the thread that draws the window (its first file takes most of a second,
// later ones a fraction of a millisecond a line). So the first lines are colored at once
// and the rest a piece at a time, plain until their turn.
const SHIKI_MAX = 200000, SHIKI_LINE_MAX = 2000; // characters; bigger files and longer lines stay in the editor
const SHIKI_PIECE = 60; // lines colored per turn
const JSON_SYNTAX = {
  dark: { key: "#7ee787", string: "#a5d6ff", literal: "#79c0ff", comment: "#8b949e", text: "#e6edf3" },
  light: { key: "#116329", string: "#0a3069", literal: "#0550ae", comment: "#6e7781", text: "#1f2328" },
};
const jsonColors = () => JSON_SYNTAX[isDark() ? "dark" : "light"];
const JSON_TOKEN = /("(?:[^"\\]|\\.)*"?)(?=(\s*:)?)|(\/\/.*|\/\*.*?(?:\*\/|$))|(-?\d[\w.+-]*|\b(?:true|false|null)\b)|(\s+)|([^\s"]+?)/g;
const ROW = 19, CHAR = 7.2; // px: a code line's height and a character's width at text size 12

// One line as runs of one color; neighbours of a color (and the spaces after them) are one run.
function jsonRuns(line) {
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
const SLIDE = 200; // ms, the tree and preview sliding in and out
const TREE_MIN = 140, PREVIEW_MIN = 160; // px, how far the line between them drags

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// Every file under `root`, relative to it: what git tracks or would (ignored files stay
// out), else what `find` sees outside .git and node_modules.
async function allFiles(root, on) {
  const git = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, on }).catch(() => null);
  let paths;
  if (git?.code === 0) paths = git.stdout.split("\0");
  else {
    const found = await exec("sh", ["-c", 'cd "$1" && find . \\( -name .git -o -name node_modules \\) -prune -o -type f -print0 | head -c 4000000', "files", root], { on });
    if (found.code !== 0) throw new Error(found.stderr || "Cannot list files");
    paths = found.stdout.split("\0").map(path => path.replace(/^\.\//, ""));
  }
  return [...new Set(paths.filter(Boolean))].slice(0, SEARCH_FILES);
}

// A path's text as runs, the letters the search matched standing out.
function marked(text, offset, marks, color, strong) {
  const runs = [];
  for (let i = 0, from = 0; i <= text.length; i++) {
    const on = marks.has(offset + from);
    if (i === text.length || marks.has(offset + i) !== on) {
      if (i > from) runs.push(div().flex_none().text_color(on ? strong : color).when(on, el => el.font_semibold()).child(text.slice(from, i)));
      from = i;
    }
  }
  return runs;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.pinned = localStorage.getItem("tree") !== "hidden"; this.width = 0;
    this.rendered = localStorage.getItem("markdown") !== "source";
    // Search: the query, every file (listed on the first search), the ranked hits, the chosen one.
    this.query = ""; this.files = null; this.hits = []; this.at = 0; this.hitScroll = VirtualListScrollHandle.new();
    this.searchHandle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search files…" });
    this.input.on("change", (_e, cx) => this.setQuery(this.input.value(), cx));
    this.input.on("submit", (_e, cx) => { const hit = this.hits[this.at]; if (hit) this.open(hit.file.path, cx); });
    this.input.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    this.treeWidth = Number(localStorage.getItem("treeWidth")) || null; this.dragging = false;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.files = null; this.hits = []; this.searchError = null; if (this.query) { this.query = ""; this.input.set_value(""); }
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
        if (this.query.trim()) this.list(cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  setQuery(query, cx) {
    if (query === this.query) return;
    this.query = query; this.at = 0;
    if (query.trim() && !this.files) this.list(cx);
    this.rank();
    cx.notify();
  }

  rank() {
    this.hits = this.files && this.query.trim() ? search(this.files, this.query, SEARCH_HITS) : [];
    for (const hit of this.hits) hit.marks = new Set(hit.positions);
    this.at = Math.min(this.at, Math.max(0, this.hits.length - 1));
    if (this.hits.length) this.hitScroll.scroll_to_item(this.at);
  }

  // Lists every file of this folder for the search, again whenever the folder changes.
  list(cx) {
    if (this.listing || !this.root) return;
    const context = this.context;
    this.listing = true;
    cx.spawn(async cx => {
      try {
        const paths = await allFiles(context.cwd, context.on);
        if (this.current(context)) { this.files = index(paths); this.searchError = null; this.rank(); }
      } catch (e) { if (this.current(context)) this.searchError = String(e); }
      finally { this.listing = false; cx.notify(); }
    });
  }

  // Opens a search hit, its folders unfolded so the tree shows where it is.
  open(path, cx) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      if (!this.folders.has(folder)) this.toggle(folder, cx);
    }
    this.show(path, cx);
    cx.notify();
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.view = null; this.markdown = null; this.file = path; this.fileError = null;
    this.shownDark = isDark(); // the appearance the preview was colored for (see render)
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const ext = path.includes(".") ? path.split(".").pop() : "txt";
        if (MARKDOWN.has(ext.toLowerCase())) this.markdown = text.length > 400000 ? text.slice(0, 400000) + "\n\n… (file truncated)" : text;
        if (ext === "json" || ext === "jsonc" || (SHIKI[ext] && text.length <= SHIKI_MAX)) {
          const body = (text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text).replace(/\r\n?/g, "\n").replace(/\t/g, "  ").replace(/\n$/, "");
          const lines = body.split("\n"), longest = lines.reduce((n, line) => Math.max(n, line.length), 0), width = Math.ceil(Math.min(longest, 4020) * CHAR);
          if (!SHIKI[ext]) { this.view = { count: lines.length, width, runs: i => jsonRuns(lines[i].length > 4000 ? lines[i].slice(0, 4000) + "… (line truncated)" : lines[i]) }; return; }
          if (longest <= SHIKI_LINE_MAX) try {
            const next = tokenizer(SHIKI[ext], SHIKI_THEME()), rows = new Array(lines.length);
            const view = { count: lines.length, width, runs: i => rows[i] ?? [{ text: lines[i], color: jsonColors().text }] };
            const color = from => next(lines.slice(from, from + SHIKI_PIECE).join("\n")).forEach((runs, k) => { rows[from + k] = runs; });
            color(0);
            this.view = view;
            // The rest in turns, letting the window draw in between; a file closed meanwhile stops them.
            const rest = (from, cx) => {
              if (from >= lines.length || this.view !== view) return;
              cx.timer.after(4, cx => {
                if (this.view !== view) return;
                try { color(from); } catch (e) { console.log("files: shiki stopped", String(e)); return; }
                cx.notify(); rest(from + SHIKI_PIECE, cx);
              });
            };
            rest(SHIKI_PIECE, cx);
            return;
          } catch (e) { console.log("files: shiki failed, using the editor", String(e)); }
        }
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: syntax() });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // The docked tree's width: the person's own once they drag the line, else about a third.
  docked() {
    if (!this.width) return this.treeWidth ?? 240;
    const auto = Math.max(170, Math.min(300, Math.round(this.width * 0.34)));
    return Math.max(TREE_MIN, Math.min(this.treeWidth ?? auto, Math.max(TREE_MIN, this.width - PREVIEW_MIN)));
  }

  drop(cx) {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.treeWidth) localStorage.setItem("treeWidth", String(this.treeWidth));
    cx.notify();
  }

  // A markdown file as it reads.
  markdownView() {
    return v_flex().id(`files-md-${this.file}`).flex_1().min_h(0).overflow_y_scrollbar().px(20).py(14)
      .child(TextView.markdown(`files-md-text-${this.file}`, this.markdown).selectable());
  }

  // A file drawn here: line numbers and colored runs, scrolling both ways.
  codeView(t) {
    const view = this.view, id = `files-code-${this.file}`;
    const numbers = Math.max(2, String(view.count).length) * CHAR + 6, gap = 21; // lines up with the editor's gutter
    const row = index => h_flex().h(ROW).flex_none().items_center().whitespace_nowrap()
      .child(div().w(numbers).mr(gap).flex_none().text_right().text_color(t.dim).child(String(index + 1)))
      .children(view.runs(index).map(run => div().flex_none().text_color(run.color).child(run.text)));
    return div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
      .child(div().id("files-code-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(numbers + gap + view.width + 24).h_full().child(v_virtual_list(id, view.count, ROW, i => String(i),
          range => Array.from({ length: range.end - range.start }, (_, k) => row(range.start + k))).size_full())))
      .child(Scrollbar.vertical(id).viewport_from_layout().absolute().inset_0());
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .when(path === this.file, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/sapphire-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/sapphire-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    // A light/dark switch: the open preview was colored for the other appearance, redo it.
    if (this.file && this.shownDark !== undefined && this.shownDark !== isDark()) this.show(this.file, cx);
    const t = theme(), open = Boolean(this.file);
    // Beside a preview, the tree takes about a third of the panel. The preview's width is
    // the one animated value: 0 with no file, the rest of the panel beside the tree, all of
    // it with the tree hidden. The tree fills what is left, so both slide together.
    const treeWidth = this.docked();
    const previewWidth = !open ? 0 : this.pinned ? Math.max(0, this.width - treeWidth) : this.width;
    const searchBar = () => h_flex().id("files-search").track_focus(this.searchHandle).h(30).flex_none().mx(6).mt(6).px(8).gap(6).items_center().rounded(7)
      .border_1().border_color(this.searching ? t.accent : t.border)
      .on_click(() => this.input.focus())
      .on_key_down((e, cx) => {
        if (e.key === "escape") { if (!this.query) return; this.input.set_value(""); this.setQuery("", cx); }
        else if (e.key === "down" && this.hits.length) this.at = (this.at + 1) % this.hits.length;
        else if (e.key === "up" && this.hits.length) this.at = (this.at + this.hits.length - 1) % this.hits.length;
        else return;
        if (this.hits.length) this.hitScroll.scroll_to_item(this.at);
        cx.stop_propagation(); cx.notify();
      })
      .child(svg("mods/sapphire-files/search.svg").size(14).flex_none().text_color(t.dim))
      .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
      .when(Boolean(this.query), el => el.child(h_flex().id("files-search-clear").size(18).flex_none().items_center().justify_center().rounded(5).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); this.input.set_value(""); this.setQuery("", cx); this.input.focus(); })
        .child(svg("mods/sapphire-files/x.svg").size(12).text_color(t.dim))));
    const hit = (found, i) => {
      const { path, base } = found.file, name = path.slice(base), folder = path.slice(0, Math.max(0, base - 1));
      // No handlers here: a virtual list takes its rows' clicks itself (on_item_click below).
      return h_flex().h(28).mx(6).px(8).gap(7).items_center().rounded(7).cursor_pointer().overflow_hidden().whitespace_nowrap()
        .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
        .child(svg("mods/sapphire-files/file.svg").size(14).flex_none().text_color(t.muted))
        .child(h_flex().flex_none().children(marked(name, base, found.marks, t.foreground, t.accent)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(11.5).children(marked(folder, 0, found.marks, t.dim, t.accent)));
    };
    const hits = () => this.hits.length
      ? div().flex_1().min_h(0).relative().pt(6)
        .child(v_virtual_list("files-hits", this.hits.length, 28, i => this.hits[i]?.file.path ?? String(i),
          range => this.hits.slice(range.start, range.end).map((found, k) => hit(found, range.start + k))).track_scroll(this.hitScroll).size_full()
          .on_item_click((path, cx) => { const i = this.hits.findIndex(found => found.file.path === path); if (i >= 0) { this.at = i; this.open(path, cx); } }))
        .child(Scrollbar.vertical("files-hits").viewport_from_layout().absolute().inset_0())
      : div().flex_1().min_h(0).p(14).text_size(12).text_color(t.dim).child(this.searchError || (this.files ? "No files match" : "Searching…"));
    const tree = () => v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(this.rows("", 0, [], t))
      .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
      .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")));
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(open, el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        // Markdown only: its source, or how it reads.
        .when(open && this.markdown !== null, el => el.child(h_flex().flex_none().gap(2).children([["source", "code", false], ["rendered", "eye", true]].map(([name, icon, rendered]) =>
          h_flex().id(`files-md-${name}`).size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
            .when(this.rendered === rendered, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { this.rendered = rendered; localStorage.setItem("markdown", name); cx.notify(); })
            .child(svg(`mods/sapphire-files/${icon}.svg`).size(15).text_color(this.rendered === rendered ? t.foreground : t.dim))))))
        .when(open, el => el.child(h_flex().id("files-tree-toggle").size(24).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
          .when(this.pinned, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.pinned = !this.pinned; localStorage.setItem("tree", this.pinned ? "shown" : "hidden"); cx.notify(); })
          .child(svg("mods/sapphire-files/panel-right.svg").size(15).text_color(this.pinned ? t.foreground : t.dim)))))
      .child(h_flex().id("files-body").relative().flex_1().min_h(0).items_start()
        // Reported in window pixels; widths written here are before the app's zoom.
        .on_size_change((size, cx) => { const width = Math.round(size.width / (settings().zoom || 1)); if (width !== this.width) { this.width = width; cx.notify(); } })
        // Both sides clip: their content keeps its final width while the edge between them moves.
        .child(v_flex().id("files-preview").w(previewWidth).h_full().min_h(0).flex_none().overflow_hidden()
          .when(!this.dragging, el => el.transition("width", { duration: SLIDE, easing: "ease-out" })) // a drag follows the pointer
          .when(open, el => el.child(v_flex().w(previewWidth).flex_1().min_h(0)
            .child(this.view ? this.codeView(t) : this.markdown !== null && this.rendered ? this.markdownView() : this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")))))
        .child(v_flex().id("files-side").flex_1().min_w(0).h_full().min_h(0).overflow_hidden()
          .child(v_flex().w_full().flex_1().min_h(0)
            .when(open, el => el.min_w(treeWidth).border_l(1).border_color(this.dragging ? t.accent : t.border))
            .child(searchBar())
            .child(this.query.trim() ? hits() : tree())
            // The tree's left edge: a grip a few px wide, lit on hover.
            .when(open && this.pinned, el => el.relative().child(div().id("files-resize").absolute().top_0().left_0().h_full().w(6).cursor_col_resize()
              .border_l(2).border_color(this.dragging ? t.accent : "#00000000").hover(s => s.border_color(t.accent))
              .on_mouse_down("left", (e, cx) => {
                cx.stop_propagation();
                if (e.click_count === 2) { this.dragging = false; this.treeWidth = null; localStorage.removeItem("treeWidth"); }
                else { this.dragging = true; this.dragSeen = false; }
                cx.notify();
              })))))
        // While dragging, a clear sheet over both sides takes the pointer: nothing under it
        // (rows, the editor, scrollbars) hovers or steals the moves, and the cursor stays.
        .when(this.dragging, el => el.child(div().id("files-drag").absolute().inset_0().cursor_col_resize()
          .on_mouse_move((e, cx) => {
            this.dragSeen = true;
            if (!e.bounds?.width || !this.width) return;
            const wanted = Math.round(this.width * (1 - e.local_position.x / e.bounds.width));
            const next = Math.max(TREE_MIN, Math.min(wanted, Math.max(TREE_MIN, this.width - PREVIEW_MIN)));
            if (next !== this.treeWidth) { this.treeWidth = next; cx.notify(); }
          })
          .on_mouse_up("left", (_e, cx) => this.drop(cx))
          .on_hover((hovered, cx) => { if (hovered) this.dragSeen = true; else if (this.dragSeen) this.drop(cx); }))));
  }
}
