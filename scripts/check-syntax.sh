#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "Checking JS syntax..."

while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find backend popup/js -type f -name "*.js" -print0)

echo "OK"

