// Source of ~/.config/herdr-app/highlight/shiki.mjs: Shiki with GitHub's dark and light
// themes and the JS-family grammars, precompiled (their regexes are already JavaScript's, so
// nothing is translated at run time: a file colors in tens of milliseconds, not hundreds). Node only.
// Rebuild (in a scratch folder, never inside this one): npm i shiki @shikijs/langs-precompiled esbuild && npx esbuild shiki.entry.mjs --bundle --format=esm --platform=node --minify --outfile=shiki.mjs
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRawEngine } from "@shikijs/engine-javascript/raw";
import tsx from "@shikijs/langs-precompiled/tsx";
import typescript from "@shikijs/langs-precompiled/typescript";
import jsx from "@shikijs/langs-precompiled/jsx";
import javascript from "@shikijs/langs-precompiled/javascript";
import dark from "@shikijs/themes/github-dark-default";
import light from "@shikijs/themes/github-light-default";

export const THEMES = { dark: "github-dark-default", light: "github-light-default" };
let highlighter;

/**
 * A tokenizer for one file, in one theme (THEMES.dark or THEMES.light, a Shiki theme
 * name). Call it with the file's lines a piece at a time, in order: it carries the
 * grammar's state (an open comment, a template string, JSX) from one piece to the next
 * and returns each line as runs, [{ text, color }], neighbours of one color joined.
 */
export function tokenizer(lang, theme = THEMES.dark) {
  highlighter ??= createHighlighterCoreSync({ themes: [dark, light], langs: [tsx, typescript, jsx, javascript], engine: createJavaScriptRawEngine() });
  const fg = highlighter.getTheme(theme).fg;
  let grammarState;
  return (code) => {
    const tokens = highlighter.codeToTokensBase(code, { lang, theme, grammarState });
    grammarState = highlighter.getLastGrammarState(tokens);
    return tokens.map((line) => {
      const runs = [];
      for (const token of line) {
        const color = token.color ?? fg, last = runs[runs.length - 1];
        if (last && (last.color === color || !token.content.trim())) last.text += token.content;
        else runs.push({ text: token.content, color });
      }
      return runs;
    });
  };
}
