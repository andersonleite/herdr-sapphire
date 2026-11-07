# herdr-sapphire

A [Herdr](https://herdr.dev) layout, `sapphire`, in dark and light, with the zsh prompt that goes
with it. Purple accent, spaces with colored avatars and `[tag]` groups, Files / Changes / Graph
panels with GitHub syntax colors (dark or light to match), Claude Code following the terminal
background.

## Install on a new machine

Prerequisites: macOS with Herdr installed and opened once (so `~/.config/herdr-app` exists),
`node`, `git`, `python3` and zsh on the PATH (`brew install node` is enough on a fresh Mac).

```sh
git clone https://github.com/andersonleite/herdr-sapphire ~/Developer/herdr-sapphire
cd ~/Developer/herdr-sapphire && ./install.sh
```

`install.sh` is idempotent (run it again after `git pull`). It does four things:

1. Appends **one line** to `~/.zshrc` (marked `# herdr-sapphire`): puts `bin/` on the PATH and
   sources `shell/prompt.zsh`. Nothing else in `.zshrc` is touched.
2. Sets `"theme": "auto"` in `~/.claude/settings.json` (merged, other keys kept) so Claude Code
   follows the terminal's light/dark background.
3. Copies `layouts/sapphire.*`, `themes/sapphire*.json`, `mods/{sapphire-spaces,sapphire-tabs,
   sapphire-files,sapphire-changes,git-graph}` and `highlight/` into `~/.config/herdr-app`
   (overwriting those names only, nothing else), runs `herdr-app check` on each mod and
   switches the window to the layout. If the switch fails, pick `sapphire` with `ctrl-shift-l`.
4. Warns if `node`, `git` or `python3` are missing.

Then open a new terminal (or `source ~/.zshrc`).

What the mods do outside their folders, for the record: they run `git` (status, log, diff,
worktrees) in the spaces' repos, `sh -c` for a few git pipelines, and `node` on
`~/.config/herdr-app/highlight/highlight.mjs` to color diffs. No network access.

## Use

- `sapphire light` / `sapphire dark` / `sapphire toggle` / `sapphire status` — switches the whole
  Herdr window live (writes `appearance` in `~/.config/herdr-app/settings.json`). UI, the code
  panels and the terminals with Claude Code follow. Claude Code sessions that were already open
  before `install.sh` need `/theme` → auto once.
- Prompt: folder, git branch, `●` staged `✚` unstaged `?` untracked `⇡n ⇣n` ahead/behind, green
  when clean, yellow when dirty; `❯` red after a failed command; commands longer than 5 s show
  their duration on the right; `user@host` only over SSH.
- Spaces named `[x] …`, `[xy] …` or `[xyz] …` form a group: same avatar color, tag shown on the
  avatar, tag hidden from the name.

## Layout of this repo

```
layouts/sapphire.json      the layout (theme: { light: sapphire-light, dark: sapphire })
layouts/sapphire.svg       its preview in Herdr's layout picker
themes/sapphire.json       dark theme
themes/sapphire-light.json light theme (off-white, purple accent, GitHub Light ANSI)
mods/sapphire-*            spaces, tabs, files, changes (forks of Herdr's shipped mods)
mods/git-graph             the Graph panel
highlight/                 Shiki syntax colors (GitHub dark/light) for Changes and Graph
shell/prompt.zsh           pure zsh prompt, no dependencies
bin/sapphire               the light/dark switch
install.sh · export.sh
```

## Develop

On the machine where the layout is developed, `~/.config/herdr-app` is the source of truth
(Herdr hot-reloads it) and holds an empty `.sapphire-dev` marker file: there `install.sh` skips
step 3, and `./export.sh` copies the layout from Herdr into this repo to commit. Everywhere
else, the repo is the source and `install.sh` copies it into Herdr.

The Shiki bundles (`mods/sapphire-files/shiki.js`, `highlight/shiki.mjs`) are built from the
`shiki.entry.mjs` next to each; the build command is in their header (run it in a scratch
folder, never inside a mod: Herdr reloads a mod on every write to its folder).

Not listed on herdr.dev on purpose (no `herdr-layout` topic); it would need a `RECIPE.md`
and `preview.png` first.

## Credits and license

`mods/sapphire-spaces`, `sapphire-tabs`, `sapphire-files` and `sapphire-changes` started as
copies of the mods Herdr ships (Apache 2.0); the Shiki bundles are built from
[shiki](https://github.com/shikijs/shiki) (MIT) with GitHub's `github-dark-default` /
`github-light-default` themes. This repo is Apache 2.0 too (see `LICENSE`).
