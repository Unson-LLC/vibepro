# Architecture: Story-scoped task authority binding

## 判断

`task bind`だけをproposalからaccepted authorityへの境界とする。入力はrepo内の
tracked JSONに限定し、Story一致、Task IDの一意性、`allowed_paths`のrepo内境界を
検証する。canonical task planには正規化済みTaskと、入力のrepo相対path・SHA-256
digestを保存する。

## 保存境界

- accepted authority: artifact routingで解決したcanonical `task_plan`
- generated proposal: `.vibepro/stories/<story-id>/diagnostics/<run-id>/tasks.json`
- human-authored task table: 既存の表示用authorityとして維持

accepted authorityが存在する場合、診断writerは常にgenerated proposal側へrouteする。
PR managerは`--task`指定時だけaccepted authorityを必須とし、Task未指定経路は変えない。
Task選択時は保存済みcanonicalだけを信用せず、tracked inputの現在digestとschemaを
再読して一致を確認する。PR範囲は現在HEADに固定し、baseがancestorであることと、
`base...HEAD`の全変更pathが選択Taskのallowed paths内であることをfail closedで確認する。

## 非採用

- Spec finalやdiagnoseによる暗黙accept: 人間の受理境界が消えるため採用しない。
- execution engine/task managerの復元: 今回必要な保存・検証境界を越えるため採用しない。
- 絶対pathや未追跡入力: provenanceがrepository historyで再現できないため採用しない。

## Rollback

CLI分岐とauthority validatorを戻し、canonical task planをbind前のtracked内容へ戻す。
診断proposalはauthorityではないため、削除せず監査証跡として残せる。
