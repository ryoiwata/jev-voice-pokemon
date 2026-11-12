#!/usr/bin/env bash
# One-time setup: builds the pret/pokered disassembly to get exact RAM/ROM symbols.
set -euo pipefail
command -v rgbasm >/dev/null || brew install rgbds
[ -d vendor/pokered ] || git clone --depth 1 https://github.com/pret/pokered.git vendor/pokered
make -C vendor/pokered -j8 red
mkdir -p src/data
npx tsx scripts/gen-data.ts
WANT=ea9bcae617fdf159b045185467ae58b2e4a48b9a
if [ -f roms/red.gb ]; then
  GOT=$(shasum roms/red.gb | cut -d' ' -f1)
  [ "$GOT" = "$WANT" ] || { echo "roms/red.gb is not the US/EU Pokémon Red build this needs (sha1 $GOT, want $WANT)"; exit 1; }
  echo "ROM ok"
else
  echo "Put your own Pokémon Red (UE) ROM at roms/red.gb (sha1 $WANT)"
fi
