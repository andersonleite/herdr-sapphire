# highlight

Syntax colors (GitHub's dark theme, via Shiki) for Anderson's Herdr mods. Not shipped by Herdr.

- `highlight.mjs`: a program the mods run with `node` (`exec("node", [path, request])`) to color
  diff lines out of process. The mods' JavaScript runtime is small and shared by every mod;
  Shiki inside it ran the window out of memory.
- `shiki.mjs`: the Shiki bundle it imports. `shiki.entry.mjs` is its source and rebuild command.
- `diff-highlight.js`: the mod-side module (JSON colored in the mod, the rest through
  `highlight.mjs`). The copies in `mods/sapphire-changes/` and `mods/git-graph/` must stay
  identical to this one: a mod can't import from outside its folder.

`mods/sapphire-files` (the Files panel) colors whole files through it too (a side with
`all: true`, a compact answer): it used to run Shiki in the mod itself, and a large file ran
the shared runtime out of memory (every mod then failed to render with `null`).

Speed: `highlight.mjs` takes about half a second per run (node starts, the grammars warm up),
so the Graph panel colors a selected commit's first files before they're clicked and keeps
colored diffs, and both panels wait up to 1.2 s for the colors before showing a diff plain.
Never write files inside a mod's folder from the mod (a log, say): the app hot-reloads it on
every write.
