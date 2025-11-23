#!/bin/bash
set -e

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NPMRC_FILE="$PROJECT_ROOT/.npmrc"

# Store original content in memory
ORIGINAL_CONTENT=""
if [ -f "$NPMRC_FILE" ]; then
  ORIGINAL_CONTENT=$(cat "$NPMRC_FILE")
else
  touch "$NPMRC_FILE"
  ORIGINAL_CONTENT=""
fi

# Function to restore original .npmrc and clean up temp files
cleanup() {
  if [ -n "$ORIGINAL_CONTENT" ]; then
    echo "$ORIGINAL_CONTENT" > "$NPMRC_FILE"
  else
    rm -f "$NPMRC_FILE"
  fi
  [ -n "$TMP_FILE" ] && rm -f "$TMP_FILE" 2>/dev/null || true
}

# Set trap to restore on exit (success or failure)
trap cleanup EXIT

# Initialize TMP_FILE variable
TMP_FILE=""

# Temporarily modify .npmrc to set @dytsou:registry to npmjs.org
if grep -q "^@dytsou:registry=" "$NPMRC_FILE" 2>/dev/null; then
  # Replace existing line - use temp file to avoid backup files
  TMP_FILE=$(mktemp)
  sed "s|^@dytsou:registry=.*|@dytsou:registry=https://registry.npmjs.org|" "$NPMRC_FILE" > "$TMP_FILE"
  mv "$TMP_FILE" "$NPMRC_FILE"
  TMP_FILE=""
else
  # Add new line - use a temporary file approach for portability
  TMP_FILE=$(mktemp)
  if grep -q "^# Registry configuration" "$NPMRC_FILE" 2>/dev/null; then
    # Insert after the registry configuration comment
    awk '/^# Registry configuration/ { print; print "@dytsou:registry=https://registry.npmjs.org"; next }1' "$NPMRC_FILE" > "$TMP_FILE"
    mv "$TMP_FILE" "$NPMRC_FILE"
    TMP_FILE=""  # Clear since we moved it
  else
    # Append to end of file
    echo "@dytsou:registry=https://registry.npmjs.org" >> "$NPMRC_FILE"
    rm -f "$TMP_FILE" 2>/dev/null || true
    TMP_FILE=""  # Clear since we don't need it
  fi
fi

# Publish to npmjs
pnpm publish --access public --registry https://registry.npmjs.org --no-git-checks
