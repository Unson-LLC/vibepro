---
story_id: story-vibepro-verify-command-test-path-existence-guard
title: verify command named test path existence guard Spec
status: active
parent_design: story-vibepro-verify-command-test-path-existence-guard
last_reviewed_root_hash: 8c355eb60560c59f204a7a36e2440e845d62983356aab2d76ef086455eed6813
---

# Spec: verify command named-test-path existence guard

正本のSpecは CLI 生成の `.vibepro/spec/story-vibepro-verify-command-test-path-existence-guard/spec.json`（clauses: INV-001, INV-002, S-001 / diagrams: state, threat_model）。本ドキュメントは Design SSOT lineage 用のポインタ。

- `INV-001`: passing record のコマンドが名指しする repo 相対 test パスに実在しないものがあれば、欠損パスを列挙して拒否し、証跡ファイルを書き込まない。
- `INV-002`: ガードは決定的かつ限定的 — glob・value-taking flag 値・URL・repo 外パス・非 pass status・パス無しコマンドは拒否しない。
- `S-001`: 実在ファイルと欠損ファイルを並べた `node --test` コマンドのインシデント再現（欠損側のみをエラーに名指し）。
