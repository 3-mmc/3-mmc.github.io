#!/usr/bin/env bash
# Rebuild the club archive and publish it to https://3-mmc.github.io/djs/
#
#   bash djs-build/publish.sh          check, rebuild, commit and push
#   bash djs-build/publish.sh --local  check and rebuild, then serve it locally
#
# The privacy scan runs first and a failure stops the publish. That is the point
# of it: this repo is public, and the archive was built from location history,
# bank statements and mail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Checks"
python3 djs-build/add.py check

echo
echo "==> Page"
python3 djs-build/build_site.py

if [[ "${1:-}" == "--local" ]]; then
  echo
  echo "==> Serving http://localhost:8000/djs/  (Ctrl-C to stop)"
  exec python3 -m http.server 8000
fi

if git diff --quiet -- djs djs-build && git diff --quiet --cached -- djs djs-build \
   && [[ -z "$(git ls-files --others --exclude-standard djs djs-build)" ]]; then
  echo
  echo "No changes to publish."
  exit 0
fi

git add djs djs-build
git -c user.name="Aaron van Blerkom" -c user.email="aaronvanblerkom@gmail.com" \
    commit -m "Update the club archive ($(date +%F))"
git push origin main
echo
echo "Published: https://3-mmc.github.io/djs/ (Pages build takes ~1 min)"
