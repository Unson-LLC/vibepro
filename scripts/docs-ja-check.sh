#!/usr/bin/env bash
# Mandatory check after rewriting a Japanese doc: numbers, negations and
# subjects must not change. Usage: scripts/docs-ja-check.sh <original> <final> [manual|article]
set -euo pipefail
if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
	echo "usage: $0 <original> <final> [manual|article]" >&2
	exit 2
fi
src="$1"
final="$2"
doc_type="${3:-article}"
case "$doc_type" in
	manual|article) ;;
	*) echo "doc type must be manual or article" >&2; exit 2 ;;
esac
export PYTHONDONTWRITEBYTECODE=1
dir="$(cd "$(dirname "$0")/../third_party/yomiyasu/scripts" && pwd)"

echo "== yomiyasu_diff --fail-on=meaning-risk"
python3 "$dir/yomiyasu_diff.py" "$src" "$final" --doc-type "$doc_type" --fail-on meaning-risk

echo "== yomiyasu_check run"
python3 "$dir/yomiyasu_check.py" run --source "$src" --final "$final" --doc-type "$doc_type" --fail-on meaning-risk
