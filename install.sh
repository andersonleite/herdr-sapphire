#!/bin/sh
# Instala o herdr-sapphire nesta máquina. Pode rodar quantas vezes quiser.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
ZSHRC="$HOME/.zshrc"
MARK="# herdr-sapphire prompt"
LINE="[ -f \"$REPO/shell/prompt.zsh\" ] && source \"$REPO/shell/prompt.zsh\" $MARK"

# 1. Prompt do zsh: uma linha no ~/.zshrc, sem duplicar.
touch "$ZSHRC"
if grep -qF "$MARK" "$ZSHRC"; then
  echo "prompt: já configurado em $ZSHRC"
else
  printf '\n%s\n' "$LINE" >> "$ZSHRC"
  echo "prompt: adicionado a $ZSHRC"
fi

# 2. TODO (ao publicar o layout): copiar layouts/, mods/ e themes/ para
#    ~/.config/herdr-app sem sobrescrever nomes já existentes, e rodar
#    `herdr-app do layout.switch '{"name":"sapphire"}'`.

echo "pronto — abra um terminal novo (ou: source $ZSHRC)"
