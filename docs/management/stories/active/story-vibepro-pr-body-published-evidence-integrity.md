---
story_id: story-vibepro-pr-body-published-evidence-integrity
title: GitHub PR本文を公開可能な証跡と現在の検証状態に一致させる
status: active
parent_design: vibepro-pr-body-published-evidence-integrity
architecture_docs:
  - docs/architecture/vibepro-pr-body-published-evidence-integrity.md
spec_docs:
  - docs/specs/vibepro-pr-body-published-evidence-integrity.md
reason: >-
  PR本文はGitHub上でレビュー判断に使える公開projectionとし、ローカル専用の.vibepro artifactは
  監査正本として維持しつつリンクではなくローカル参照として表示する。artifactを追跡対象にする案は
  下流repoへ大量の実行証跡を混入させるため採用しない。検証コマンドが自動検出できない場合も、
  current-headのpassing evidenceを本文へ投影し、証跡がない場合だけ未完了fallbackを残す。
  変更はPR本文projectionに限定し、Gate DAG・evidence binding・PR作成契約は変更しない。
---

# Story: GitHub PR本文を公開可能な証跡と現在の検証状態に一致させる

## Background

VibeProのGitHub PR本文は、Gateがreadyでcurrent-headの検証証跡も存在するのに、
自動検出されたverification commandが0件だと「手動確認または対象テストを追記する」という
未完了チェックを表示する。また、`.vibepro/` は `vibepro init` によりgitignoreされるローカル
workbenchなのに、PR本文ではGitHubのクリック可能リンクとして表示され、fresh checkoutでは404になる。

STAYeの実PR準備でこの2つが同時に発生し、本文のready表示、検証表示、証跡導線が互いに矛盾した。
PR本文は監査ログではなくGitHub上の判断ブリーフなので、公開可能性とcurrent-head evidenceを基準に
projectionを作る必要がある。

主な利用者は、VibeProが生成したGitHub PRをレビューする開発者・アーキテクトである。利用場面は
fresh checkoutまたはGitHub UI上で、本文だけを起点にready判定と検証根拠を確認する時である。
成功状態は、本文のチェック状態がcurrent-head evidenceと一致し、クリック可能な導線がGitHub公開用の
repo path allowlistに限定され、ローカルworkbench参照がリンクにならないことである。

## Acceptance Criteria

- 自動検出verification commandが0件でも、current-headのpassing verification evidenceがあれば、PR本文の確認欄はその証跡を完了済みとして表示し、未完了fallbackを表示しない。
- current-headのpassing verification evidenceが存在しない場合だけ、「手動確認または対象テストを追記する」の未完了fallbackを表示する。
- `.vibepro/` 配下のPR準備・判断索引・verification・最終E2E artifactは、GitHubリンクではなくローカルVibePro workbenchのinline code参照として表示する。
- 自由文に既存Markdown形式の`.vibepro/`リンクが含まれる場合もinline codeへ正規化し、既存のtracked repo pathリンクは維持する。
- 通常本文だけでなく、Gate waiver追記、GitHub本文上限超過時のlimit notice、minimal fallback、forced fallbackでも、`.vibepro/` 参照をローカルinline codeとして表示する。
- `docs/`、`src/`、`test/` など既存のrepo path allowlistに一致する相対パスは、従来どおりクリック可能なMarkdownリンクとして表示する。formatterではfilesystem/Gitの存在確認を追加しない。
- Gate readiness、verification binding、PR create/merge経路は変更しない。

## Tasks

- [x] PR本文のverification projectionをcurrent-head evidence fallbackへ対応する。
- [x] ローカル専用artifactと公開repo pathの表示を分離する。
- [x] 通常本文・Gate waiver追記・audit log省略時のlimit notice・minimal/forced fallbackへ同じ公開可能性ルールを適用する。
- [x] current/pass、証跡なし、stale/pass、current/failの正負回帰テストを追加する。
- [x] direct detail、verification、最終E2E、plain自由文、既存Markdown形式自由文のpath経路を回帰テストで固定する。
- [x] Gate readiness、binding、PR create/merge enforcementの不変性を確認する。
- [x] 既存のPR body path link契約と派生E2Eを公開可能性の境界へ更新する。
