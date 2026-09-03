# 0.2.0-beta.21 リリース境界

## 境界

実装済みのIssue #518修正は変更せず、version metadataとversion契約テストだけを更新する。公開は既存のpost-merge workflowを唯一の経路とする。

## 実行順序

リリースPRのCI成功とマージ後、workflowがnpm publish、Git tag、GitHub prereleaseを収束させる。

## 完了判定

npmの`gitHead`、GitHub tag target、fresh installのruntime identityが同じマージSHAを示した時だけ本番反映完了とする。
