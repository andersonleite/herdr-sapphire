#!/bin/sh
# Copia o layout sapphire de ~/.config/herdr-app (onde ele é editado ao vivo) para este
# repo, para versionar e publicar. Sentido único: Herdr → repo.
set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
SRC="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

copy() { # copy <origem relativa> <destino relativo>
  mkdir -p "$REPO/$(dirname "$2")"
  if [ -d "$SRC/$1" ]; then
    rm -rf "$REPO/$2"
    # sem gpui-kit.d.ts/jsconfig.json (o Herdr os fornece) e sem node_modules
    rsync -a --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude node_modules "$SRC/$1/" "$REPO/$2/"
  else
    cp "$SRC/$1" "$REPO/$2"
  fi
  echo "  $2"
}

echo "exportando de $SRC:"
copy layouts/sapphire.json layouts/sapphire.json
copy layouts/sapphire.svg  layouts/sapphire.svg
copy themes/sapphire.json       themes/sapphire.json
copy themes/sapphire-light.json themes/sapphire-light.json
for m in sapphire-spaces sapphire-tabs sapphire-files sapphire-changes git-graph; do
  copy "mods/$m" "mods/$m"
done
copy highlight highlight
echo "ok"
