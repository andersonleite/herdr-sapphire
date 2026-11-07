# herdr-sapphire

Layout `sapphire` do [Herdr](https://herdr.dev), em dark e light, com o prompt de shell que o acompanha.

```
layouts/sapphire.json     o layout (theme: { light: sapphire-light, dark: sapphire })
themes/sapphire.json      tema dark
themes/sapphire-light.json tema light (off-white, acento roxo, ANSI GitHub Light)
mods/sapphire-*           spaces, tabs, files, changes (clones dos mods do Herdr)
mods/git-graph            painel Graph
highlight/                cores de sintaxe (Shiki, GitHub dark/light) para Changes e Graph
shell/prompt.zsh          prompt zsh puro: pasta, branch git, status, duração
bin/sapphire              `sapphire light|dark|toggle|status`
```

## Usar

- `./install.sh` — adiciona ao `~/.zshrc` o prompt e o `bin/` no PATH, e põe `theme: auto` no
  Claude Code (`~/.claude/settings.json`) para ele seguir o fundo do terminal. Idempotente.
- `sapphire light` / `sapphire dark` — troca a aparência do Herdr ao vivo (grava `appearance` em
  `~/.config/herdr-app/settings.json`). UI, painéis de código (Files, Changes, Graph) e os
  terminais com Claude Code acompanham. Sessões do Claude Code abertas antes do `install.sh`
  precisam de `/theme` → auto uma vez.

## Desenvolver

O layout é editado ao vivo em `~/.config/herdr-app/` (hot reload). `./export.sh` copia de lá
para este repo. Os bundles do Shiki (`mods/sapphire-files/shiki.js`, `highlight/shiki.mjs`)
são gerados dos `shiki.entry.mjs` ao lado; o comando de rebuild está no topo de cada um
(rodar numa pasta de rascunho, nunca dentro do mod).

Publicação (herdr.dev, topic `herdr-layout`): falta `RECIPE.md`, `preview.png` e a cópia
reversa no `install.sh`.
