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

# 3. TODO (ao publicar o layout): copiar layouts/, mods/, themes/ e highlight/ do repo
#    para ~/.config/herdr-app sem sobrescrever nomes já existentes, e rodar
#    `herdr-app do layout.switch '{"name":"sapphire"}'`.

echo "pronto — abra um terminal novo (ou: source $ZSHRC)"
