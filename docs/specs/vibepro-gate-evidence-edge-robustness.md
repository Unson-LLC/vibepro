---
story_id: story-vibepro-gate-evidence-edge-robustness
title: Gate Evidence Edge Robustness Spec
parent_design: vibepro-gate-evidence-edge-robustness
---

# Gate Evidence Edge Robustness Spec

## 目的

gate evidence機構の2つの局所的な脆さを塞ぐ。壊れたworkspace（ディレクトリの場所にファイル）や
将来の呼び出し追加でも、`pr prepare` の走査が例外で止まったり、evidence itemのkindが黙って
上書きされたりしないようにする。salvageブランチの6編集のうち、上流未解決・安全・実利ありと
シニア判断で確認できた2件のみを正式化する。

## 変更

### 1. safeReaddir（src/execution-state.js）

```
ENOENT → []           （従来）
ENOTDIR → []          （追加: ディレクトリのはずがファイル＝壊れたworkspace）
その他 → throw         （従来: 権限エラー等は隠さない）
成功 → sorted entries  （従来）
```

### 2. buildEvidenceItem（src/pr-manager.js）

`...extra` を先頭展開に変更し、明示引数と既定値付きフィールドが常に勝つようにする。

```
{ ...extra,                                   // 記述的フィールドを先に展開
  kind, ref,                                  // 明示引数が勝つ
  strength: extra.strength ?? 'declared',
  strength_reason: extra.strength_reason ?? 'strength was not classified',
  binding_status: extra.binding_status ?? 'n/a',
  artifact_quality: extra.artifact_quality ?? 'unknown' }
```

あわせて `buildDocumentationEvidence` 内 `add` の `{ ...extra, kind }` 回避策から冗長な `kind` を除去。

## テスト対応（test/gate-evidence-edge-robustness.test.js）

- GER-S-001 = INV-GER-1: ENOTDIR/ENOENT/成功の分岐
- GER-S-002 = SC-GER-2: 非ENOENT/ENOTDIRエラーの再throw
- GER-S-003 = INV-GER-3: 明示kind/refがextraに勝つ
- GER-S-004 = INV-GER-4: 既定値の適用と値の保持
- GER-S-005 = SC-GER-5: 記述的extraフィールドの保持＋回避策不要の実証
- GER-S-001 = SC-GER-6: execution-state scanning workflowのreaddir-outcome状態遷移（entries/継続空/再throw）。ENOTDIRもENOENTと同じ「継続空」状態へ遷移させ、pr-prepare/reconcile workflowをresilientに保つ

## 非目標

- salvageの他4編集の取り込み（auth境界パスゲート・command.kind照合はセキュリティ/契約bindingを
  弱めるため除外、残り2件は上流で既に解決済み・消費者なし）
- 走査系・evidence機構のロジック再設計
