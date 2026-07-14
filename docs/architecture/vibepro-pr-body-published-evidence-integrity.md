---
story_id: story-vibepro-pr-body-published-evidence-integrity
title: GitHub PR body published evidence integrity architecture
---

# Architecture

## Decision

GitHub PR本文を、VibeProのローカル監査artifactそのものではなく、公開可能な判断projectionとして扱う。

`renderPrBody` は従来どおりGate DAGとverification evidenceを入力にするが、確認欄は次の優先順位で構成する。

1. 自動検出verification commandと一致するcurrent-head passing evidence
2. 自動検出commandには現れないcurrent-head passing evidence
3. 1と2が存在しない場合だけ未完了fallback

パス表示は、gitignoreされるVibeProローカルworkbench（`.vibepro/`）と、GitHub公開用のrepo path allowlistを分離する。前者はinline codeで表示し、後者だけ既存のMarkdown link formatterへ渡す。この境界は通常の `renderPrBody` だけでなく、render後に利用者入力を追記する `appendGateOverrideToPrBody`、GitHub本文上限超過時に実際の投稿本文を作る `appendPrBodyLimitNotice` と `buildMinimalGithubPrBody` にも共通適用する。

repo path allowlistは表示projectionの同期的な構文契約であり、描画時にfilesystemやGitへ問い合わせて存在を再判定する契約ではない。正本・変更ファイル・テストなどの構造化入力は既存どおりGit差分とStory分類から供給し、自由文ではallowlist外と `.vibepro/` をリンク化しない。この境界により、削除ファイルや比較先branchのpathを含むPR本文でも描画処理を非同期化せず、Gate/evidence収集責務とも混合しない。

表示責務は次の依存方向に固定する。

1. verification evidence収集・current-head bindingが事実を提供する
2. Gate DAGとPR enforcementが可否を判定する
3. GitHub body projectionが事実と判定を表示用に変換する

projectionから上流のevidenceやGate判定を変更してはならない。

## Boundaries

- 変更対象は `src/pr-manager.js` のGitHub投稿本文projection全経路と対応テストに限定する。
- 公開面は通常本文、Gate waiver追記、audit log省略後のlimit notice、minimal fallback、forced fallbackの全経路とする。
- `.vibepro/` artifactの生成・保存・Gate入力・canonical auditへの昇格は変更しない。
- evidenceのpassing判定は既存のcurrent-head bindingとstatus正規化を再利用する。
- `docs/`、`src/`、`test/` など既存のrepo path allowlistによるlink契約は維持する。存在確認は入力生成側の責務であり、formatterでは行わない。
- 既存 `vibepro-pr-body-path-links` のうち `.vibepro` を公開リンクとする条項は、本設計の公開可能性境界で置換する。

## Verification boundaries

- current/pass evidenceは自動検出commandが0件でもchecked表示する。
- evidenceなし、stale/pass、current/failはchecked表示の根拠にしない。
- direct detail、verification checklist、final E2E、自由文linkifierの各経路で `.vibepro` をinline表示する。
- 自由文に既存Markdown形式の `.vibepro` linkが入力された場合もinline codeへ正規化し、既存のtracked Markdown linkは維持する。
- `pr create --allow-needs-verification` のwaiver reasonをrender後に追記する経路でも、実際にGitHubへ渡すbody-file上で同じ正規化とtracked link維持を確認する。
- `## 監査ログ` を含む65,536文字超fixtureでaudit log省略後のlimit noticeを直接通し、別fixtureでminimal/forced fallbackも同じ境界を確認する。
- trackedな `docs/`、`src/`、`test/` と動的route pathはリンクを維持する。
- 旧 `.vibepro` Markdown linkを直接期待する既存テストはすべて本文表示だけをinline codeへ更新し、各テストのGate固有assertは維持する。
- `pr-prepare.json` のGate readinessとevidence binding、既存PR create/merge enforcementテストは不変である。

## Alternatives

- `.vibepro/` を全repoでforce-trackする案は、実行ログと一時artifactを下流repoへ混入させるため却下する。
- PR本文からローカルartifact参照を完全に消す案は、ローカル監査へのhandoffを失うため却下する。
- Gateがreadyなら無条件に確認済みと表示する案は、個別evidenceの根拠を失うため却下する。

## Rollback

PR本文formatterとテストだけをrevertすれば従来表示へ戻せる。Gate DAG、verification evidence schema、保存済みartifactにはmigrationを要しない。
