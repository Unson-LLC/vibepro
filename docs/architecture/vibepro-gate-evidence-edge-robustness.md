---
story_id: story-vibepro-gate-evidence-edge-robustness
title: Gate Evidence Edge Robustness Architecture
parent_design: vibepro-gate-evidence-edge-robustness
---

# アーキテクチャ

## 判断

gate evidence機構には2つの局所的な脆さが残っている。どちらも「壊れた入力・将来の呼び出し追加で
黙って壊れる」系で、直近のcorrupt-artifact対策（JADJ-S-011）と同じ堅牢化の系列にある。

**1. `safeReaddir` のエラー分類が不十分（execution-state.js）**。この関数の設計意図は「走査対象が
無ければ空配列を返す」で、現状 `ENOENT`（パス不在）のみを非致命として扱う。しかし本来ディレクトリ
であるべきパスにファイルが存在する壊れたworkspaceでは `readdir` が `ENOTDIR` を投げ、走査系
（`pr` 配下・audit配下の列挙）が例外で停止する。`ENOTDIR` も「エントリなし」と意味的に等価なので
`[]` を返すのが正しい。それ以外のエラー（権限等）は従来どおり throw して隠さない。

**2. `buildEvidenceItem` の spread順序が明示引数を上書きし得る（pr-manager.js）**。現状 `...extra` を
最後に展開しているため、`extra` に `kind` / `ref` が含まれると明示引数を黙って上書きできる。実際、
`buildDocumentationEvidence` 内の `add` は `{ ...extra, kind }` という回避策で同じkindを二重指定して
これを避けている（＝footgunが既に存在する証拠）。`...extra` を先頭に展開し、明示引数と既定値付き
フィールド（`kind` / `ref` / `strength` / `strength_reason` / `binding_status` / `artifact_quality`）が
常に勝つようにすれば、evidence itemのidentityが呼び出し側の追加フィールドに侵食されなくなり、
回避策も不要になる。`extra` の記述的フィールド（`matched_file_count`・`investigation_files`・
`deprecation` 等）は先頭展開により従来どおり保持される。

いずれもロジックの再設計ではなく、エラーハンドリングとフィールド優先順位の局所修正に限定する。
これはsalvageブランチ（`salvage/pre-reevolve-main-2026-07-14`）の6編集をシニア判断で精査し、
上流未解決・安全・実利ありと確認できた2件のみを正式化したものである（auth境界のパスゲートと
responsibility `command.kind` 直接照合はセキュリティ/契約bindingを弱めるため明示的に除外）。

## 入力

- `safeReaddir(dir)`: 走査対象ディレクトリのパス
- `buildEvidenceItem(kind, ref, extra)`: evidence itemのkind・ref・追加フィールドbag

## 出力

- `safeReaddir`: ソート済みエントリ配列。`ENOENT`/`ENOTDIR` は `[]`。それ以外は throw
- `buildEvidenceItem`: `{ kind, ref, strength, strength_reason, binding_status, artifact_quality, ...記述的フィールド }`。
  `kind`/`ref`/既定値付きフィールドは常に明示引数・既定値が勝ち、記述的フィールドは保持される

## 境界

- テスト用に `safeReaddir` と `buildEvidenceItem` を named export する（純粋ヘルパー、repoの既存export慣習に沿う）
- 走査系・evidence機構のロジックは再設計しない。2つの局所修正に限定する
- salvageの他4編集（auth境界パスゲート・`add(item.kind)`・explicit kindsへのnegative_path系追加・
  responsibility `command.kind` 照合）は本Storyのスコープ外（除外理由はStory参照）
- `buildEvidenceItem` の呼び出し互換性は保つ（既存呼び出しは全て明示引数が正しいkind/refを渡しており、
  spread順序変更で挙動が変わるのは「extraが明示引数と衝突する場合」のみ＝現状その唯一の該当箇所は
  回避策付きの1箇所で、本修正で回避策を除去する）
