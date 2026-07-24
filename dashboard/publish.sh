#!/usr/bin/env bash
# Rebuild the Uzbekistan Data Atlas and publish it to
# https://3-mmc.github.io/uzbekistan/
#
#   bash dashboard/publish.sh          rebuild, commit and push
#   bash dashboard/publish.sh --local  rebuild only, then serve it locally
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Data payloads"
python3 dashboard/build_data.py

echo
echo "==> Pages"
python3 dashboard/build_site.py

if [[ "${1:-}" == "--local" ]]; then
  echo
  echo "==> Serving http://localhost:8000/uzbekistan/  (Ctrl-C to stop)"
  echo "    The site fetches JSON, so it needs a server — file:// will not work."
  exec python3 -m http.server 8000
fi

if git diff --quiet -- uzbekistan && git diff --quiet --cached -- uzbekistan \
   && [[ -z "$(git ls-files --others --exclude-standard uzbekistan)" ]]; then
  echo
  echo "No changes to publish."
  exit 0
fi

git add uzbekistan
git -c user.name="Aaron van Blerkom" -c user.email="aaronvanblerkom@gmail.com" \
    commit -m "Update Uzbekistan Data Atlas ($(date +%F))"
git push origin main
echo
echo "Published: https://3-mmc.github.io/uzbekistan/ (Pages build takes ~1 min)"
