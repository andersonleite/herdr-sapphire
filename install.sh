#!/bin/sh
# Instala o herdr-sapphire nesta máquina. Pode rodar quantas vezes quiser.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
ZSHRC="$HOME/.zshrc"
MARK="# herdr-sapphire"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# 1. Shell: prompt + comando `sapphire` no PATH. Uma linha no ~/.zshrc, sem duplicar
#    (linhas antigas com o marcador são substituídas).
touch "$ZSHRC"
LINE="export PATH=\"$REPO/bin:\$PATH\"; [ -f \"$REPO/shell/prompt.zsh\" ] && source \"$REPO/shell/prompt.zsh\" $MARK"
if grep -qF "$MARK" "$ZSHRC"; then
  grep -vF "$MARK" "$ZSHRC" > "$ZSHRC.tmp" && mv "$ZSHRC.tmp" "$ZSHRC"
fi
printf '%s\n' "$LINE" >> "$ZSHRC"
echo "shell: prompt e comando sapphire em $ZSHRC"

# 2. Claude Code segue o fundo do terminal (light/dark): theme = auto.
if command -v python3 >/dev/null 2>&1; then
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  python3 - "$CLAUDE_SETTINGS" <<'PY'
import json, os, sys
path = sys.argv[1]
data = {}
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
if data.get("theme") != "auto":
    data["theme"] = "auto"
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    print("claude: theme = auto")
else:
    print("claude: theme já é auto")
PY
fi

# 3. Layout, temas, mods e highlight → pasta do Herdr. Só toca nos nomes deste pacote
#    (sapphire*, git-graph, highlight/); o resto da pasta fica como está.
#    Na máquina onde o layout é desenvolvido (marcador .sapphire-dev) a fonte da verdade é
#    a pasta do Herdr, então esta etapa é pulada: use ./export.sh no sentido contrário.
HERDR="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
if [ -f "$HERDR/.sapphire-dev" ]; then
  echo "herdr: $HERDR é a cópia de desenvolvimento (.sapphire-dev); layout não copiado"
else
  mkdir -p "$HERDR/layouts" "$HERDR/themes" "$HERDR/mods"
  cp "$REPO/layouts/sapphire.json" "$REPO/layouts/sapphire.svg" "$HERDR/layouts/"
  cp "$REPO/themes/sapphire.json" "$REPO/themes/sapphire-light.json" "$HERDR/themes/"
  for m in sapphire-spaces sapphire-tabs sapphire-files sapphire-changes git-graph; do
    rm -rf "$HERDR/mods/$m"
    cp -R "$REPO/mods/$m" "$HERDR/mods/$m"
  done
  rm -rf "$HERDR/highlight"
  cp -R "$REPO/highlight" "$HERDR/highlight"
  echo "herdr: layout sapphire copiado para $HERDR"
  if command -v herdr-app >/dev/null 2>&1 && [ -z "${HERDR_APP_HOME:-}" ]; then
    for m in sapphire-spaces sapphire-tabs sapphire-files sapphire-changes git-graph; do
      (cd "$HERDR" && herdr-app check "mods/$m") || echo "aviso: herdr-app check falhou em $m"
    done
    herdr-app do layout.switch '{"name":"sapphire"}' >/dev/null 2>&1 \
      && echo "herdr: layout sapphire ativo" \
      || echo "herdr: abra o Herdr e escolha o layout sapphire (ctrl-shift-l)"
  fi
fi

# 4. O que o layout precisa para rodar.
for p in node git python3; do
  command -v "$p" >/dev/null 2>&1 || echo "aviso: '$p' não está no PATH; os painéis Changes/Graph (node) ou o comando sapphire (python3) não vão funcionar"
done

echo "pronto — abra um terminal novo (ou: source $ZSHRC)"
