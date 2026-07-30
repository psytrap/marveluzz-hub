#!/bin/sh
# Marveluzz Hub Hook Module 2: Interactive Version Uprev Prompt

STAGED_CHANGES=$(git diff --cached --name-only | grep -E '^(src/|public/|supabase/migrations/)')

if [ -z "$STAGED_CHANGES" ]; then
  exit 0
fi

echo ""
echo "⚡ [Module 2/2] Detected staged application / migration changes:"
echo "$STAGED_CHANGES" | sed 's/^/   • /'
echo ""

# Ensure we read directly from TTY terminal
if [ -t 0 ]; then
  READ_CMD="read RESPONSE"
elif [ -c /dev/tty ]; then
  READ_CMD="read RESPONSE < /dev/tty"
else
  READ_CMD=""
fi

if [ -n "$READ_CMD" ]; then
  printf "❓ Uprev version? ([p]atch / [m]inor / [M]ajor / [s]kip) [default: p]: "
  eval "$READ_CMD"
else
  echo "ℹ️ Non-interactive terminal environment. Defaulting to patch uprev."
  RESPONSE="p"
fi

case "$RESPONSE" in
  [mM][iI][nN][oO][rR]|m)
    echo "🚀 Running minor uprev..."
    deno task uprev minor
    git add src/db.ts examples/emulator/device_emulator.ts
    echo "✅ Staged minor version uprev."
    ;;
  [mM][aA][jJ][oO][rR]|M)
    echo "🚀 Running major uprev..."
    deno task uprev major
    git add src/db.ts examples/emulator/device_emulator.ts
    echo "✅ Staged major version uprev."
    ;;
  [sS][kK][iI][pP]|s|n|N)
    echo "⏩ Skipping version uprev."
    ;;
  ""|[pP]|[pP][aA][tT][cC][hH]|*)
    echo "🚀 Running patch uprev [default: p]..."
    deno task uprev patch
    git add src/db.ts examples/emulator/device_emulator.ts
    echo "✅ Staged patch version uprev."
    ;;
esac

exit 0
