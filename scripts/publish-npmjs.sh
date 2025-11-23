#!/bin/bash
set -e

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NPMRC_FILE="$PROJECT_ROOT/.npmrc"
PACKAGE_JSON="$PROJECT_ROOT/package.json"

# Get version from package.json
VERSION=$(node -p "require('$PACKAGE_JSON').version")
PACKAGE_NAME=$(node -p "require('$PACKAGE_JSON').name")

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

# Check if version already exists on npmjs.org
if npm view "$PACKAGE_NAME@$VERSION" version --registry=https://registry.npmjs.org >/dev/null 2>&1; then
  echo "Version $VERSION already exists on npmjs.org, skipping publish"
  exit 0
fi

# Publish to npmjs
TMP_PUBLISH_LOG=$(mktemp)
if pnpm publish --access public --registry https://registry.npmjs.org --no-git-checks > "$TMP_PUBLISH_LOG" 2>&1; then
  cat "$TMP_PUBLISH_LOG"
  rm -f "$TMP_PUBLISH_LOG"
else
  PUBLISH_EXIT_CODE=$?
  PUBLISH_OUTPUT=$(cat "$TMP_PUBLISH_LOG" 2>/dev/null || echo "")
  cat "$TMP_PUBLISH_LOG"
  rm -f "$TMP_PUBLISH_LOG"
  
  # Check if the error is because version already exists
  if echo "$PUBLISH_OUTPUT" | grep -q "You cannot publish over the previously published versions"; then
    echo "Version $VERSION already exists on npmjs.org, skipping publish"
    exit 0
  fi
  
  # If publish failed, check if version was published (race condition)
  if npm view "$PACKAGE_NAME@$VERSION" version --registry=https://registry.npmjs.org >/dev/null 2>&1; then
    echo "Version $VERSION was published successfully (may have been published concurrently)"
    exit 0
  else
    echo "Publish failed for unknown reason"
    exit $PUBLISH_EXIT_CODE
  fi
fi
