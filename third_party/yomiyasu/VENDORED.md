# Vendored: yomiyasu

- Upstream: https://github.com/nanaism/yomiyasu
- Version: v2.2.2 (commit 488dd37c0baa67ec65bf155aced9fa1a01d261e2)
- Copied path: `skills/yomiyasu/` from that commit, unchanged, except `assets/` (one PNG image) left out.
- License: MIT (`LICENSE` in this directory). The emoji tables in `scripts/yomiyasu_lint.py` are derived from Unicode 18.0 data under Unicode License V3 (`UNICODE-LICENSE.txt`, also `LICENSES/Unicode-3.0.txt`). `REUSE.toml` records both.
- Verify the copy: `diff -r <upstream>/skills/yomiyasu third_party/yomiyasu` must list only `assets` and `VENDORED.md`.

To update, copy `skills/yomiyasu/` from a new upstream tag, then change the version and commit above in the same commit.
