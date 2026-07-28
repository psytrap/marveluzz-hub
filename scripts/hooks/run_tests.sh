#!/bin/sh
# Marveluzz Hub Hook Module 1: Test Suite Verification

echo "🧪 [Module 1/2] Running Marveluzz Hub Test Suite (deno test -A)..."
deno test -A

TEST_EXIT_CODE=$?
if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo ""
  echo "❌ Integration / Staging Test Suite Failed! Aborting commit."
  exit 1
fi

echo "✅ [Module 1/2] All 25 tests passed cleanly."
exit 0
