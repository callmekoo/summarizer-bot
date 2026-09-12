#!/usr/bin/env bash
set -uo pipefail

input=$(cat)
# Иначе проверка зациклится.
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0

# В PATH хука npm может не быть.
if ! command -v npm >/dev/null; then
  nvm_bin=$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
  [ -n "$nvm_bin" ] && export PATH="$nvm_bin:$PATH"
fi

if ! command -v npm >/dev/null; then
  jq -nc '{systemMessage: "npm не найден — npm run check пропущен"}'
  exit 0
fi

out=$(npm run check 2>&1) && exit 0

# В логе check почти всё — успешные тесты.
fail=$(grep -E 'error TS|^not ok |^# fail [1-9]|^\[warn\] |^\[error\] ' <<<"$out" | head -n 40)
[ -z "$fail" ] && fail=$(tail -n 30 <<<"$out")

jq -nc --arg o "$fail" \
  '{decision: "block", reason: ("npm run check не прошёл:\n" + $o)}'
