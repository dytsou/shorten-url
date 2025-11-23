#!/bin/bash
set -e

# Save original registry config
ORIGINAL_REGISTRY=$(npm config get @dytsou:registry || echo "")

# Temporarily set registry to npmjs for @dytsou scope
npm config set @dytsou:registry https://registry.npmjs.org

# Publish to npmjs
pnpm publish --access public --registry https://registry.npmjs.org

# Restore original registry config
if [ -n "$ORIGINAL_REGISTRY" ]; then
  npm config set @dytsou:registry "$ORIGINAL_REGISTRY"
else
  npm config delete @dytsou:registry
fi

