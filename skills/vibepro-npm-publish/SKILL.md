---
name: vibepro-npm-publish
description: Use when publishing VibePro to npm, preparing or monitoring a VibePro release, reconciling npm dist-tags or GitHub Releases, or proving that a requested VibePro version is publicly usable.
---

# VibePro npm Publish

## Purpose

VibeProのnpm公開を、準備・検証・マージ・公開・外部照合・復旧に分けて安全に完了する。PRのマージやGitHub Actionsの成功だけを「npm公開済み」と扱わず、同一commitへ結び付いたnpm、Git tag、GitHub Release、導入済みruntimeの証拠で完了を判定する。

## When to Use

次の依頼で使う。

- 「VibeProをnpm公開して」「マージして公開まで」「新しいbetaを出して」
- VibeProのrelease PR、post-merge release、npm dist-tag、GitHub Releaseを準備または復旧する
- 公開が遅い、止まった、部分的にしか完了していない原因を調べる
- 特定versionがnpmから実際に導入でき、期待sourceと一致することを証明する

単なる実装、PR作成、一般的なnpmパッケージ公開には使わない。

## Authority Boundary

- npm公開、dist-tag変更、GitHub Release変更、マージは外部状態を変える。ユーザーが「公開まで」「npmへ出して」まで明示した時だけ実行する。
- 「公開準備」「リリースPRを作る」はPR作成までの権限であり、マージや公開の権限ではない。
- versionは承認済みのrelease要件と`package.json`から決める。未承認のversionを推測して作らない。
- VibePro自身の開発は現在の`AGENTS.md`に従う。minimal-core rebuild中はplain git flowを使い、廃止されたself-dogfood Gateや`vibepro execute merge`を復活させない。
- secretは値を表示しない。名前の存在、認証コマンドの成否、権限範囲だけを確認する。

## Required Workflow

### 1. 正本と実行環境を固定する

```bash
git status --short --branch
git remote -v
git rev-parse HEAD
git fetch origin main
node -p "require('./package.json').version"
```

- dirty treeは分類して保全し、公開作業は最新`origin/main`から独立worktreeを作る。
- npm/GitHubの認証は公開前に確認する。値は出さない。

```bash
npm whoami
gh auth status
npm view vibepro dist-tags --json
```

認証失敗、timeout、registry応答欠落は`未確認`であり、成功や0件へ変換しない。

### 2. release PRを一つの意図へ限定する

release PRは原則としてversion、package lock、現在の`AGENTS.md`が要求するStory→Spec→code traceability、必要なcatalog/release noteだけに限定する。ArchitectureやTaskなど、廃止済みのself-dogfood成果物を儀式として復活させない。runtime修正やworkflow修正を同乗させない。

- npmのversionはimmutableである。すでに存在するversionを再利用しない。
- prerelease/stable、npm dist-tag、GitHub Releaseの期待分類は`post-merge-release.mjs`のplanまたは同等の正本ロジックから得る。一般的なSemVer知識だけで決めない。
- package対象を`npm pack --dry-run`で確認し、`.vibepro/`、secret、内部監査物、不要なrelease docsを混入させない。
- 一つのfocused commitへ明示stageする。

### 3. 変更面を必要十分に検証する

最初にrelease固有テスト、型検査、pack dry-runを実行する。

```bash
node --test test/post-merge-release.test.js test/github-release-convergence.test.js
npm run typecheck
npm pack --dry-run
```

source変更が含まれる、またはexact-SHAへ結び付いた信頼可能な全体証拠がない場合はフルテストも実行する。

```bash
node --test --test-concurrency=2
```

同じtreeで既に成功したフルテストを、対象面変更なしのままレビュー担当ごとに繰り返さない。レビューは既存ログと差分を読み、追加リスクに絞ったテストを選ぶ。ただし現行workflowがフルテストを要求している間は、ローカル判断でworkflow stepを飛ばさない。高速化はIssue #458の実装契約に従う。

### 4. PR CIをexact SHAへ結び付ける

plain git flowでPRを作り、Node 20、Node 22、CodeQLなどrepositoryの必須checkを待つ。PR headとcheck suiteのSHAが一致した時だけCIを公開根拠に使う。

```bash
git push -u origin <release-branch>
gh pr create --repo Unson-LLC/vibepro --base main --head <release-branch>
gh pr checks <pr-number> --watch --repo Unson-LLC/vibepro
```

CI成功後にpackage対象ファイルを変更したら、古いcheckを再利用しない。current headのcheckとreviewを取り直す。

### 5. mergeとpost-merge workflowを監視する

明示された公開権限とrepositoryのplain git flowに従ってmergeする。merge commit SHAを記録し、default branchのpost-merge workflowがそのPRとSHAを対象にしていることを確認する。

```bash
gh pr merge <pr-number> --repo Unson-LLC/vibepro --merge
gh run list --repo Unson-LLC/vibepro --workflow post-merge-release.yml --limit 10
gh run watch <run-id> --repo Unson-LLC/vibepro --exit-status
gh run view <run-id> --repo Unson-LLC/vibepro --log-failed
```

workflowがnpm公開後のdocs同期で失敗した場合、npm公開を未実行へ巻き戻さない。段階別に`published_but_docs_failed`のような部分状態として扱う。

### 6. 公開面を同じcommitへ収束させる

以下をすべて満たすまで「npm公開完了」と言わない。

```bash
VERSION="<package-version>"
RELEASE_SHA="<merge-commit-sha>"

npm view "vibepro@$VERSION" version gitHead dist-tags --json
npm view vibepro dist-tags --json
npm view vibepro time --json
git ls-remote origin "refs/tags/v$VERSION"
gh release view "v$VERSION" --repo Unson-LLC/vibepro \
  --json tagName,targetCommitish,isPrerelease,publishedAt,url
gh api repos/Unson-LLC/vibepro/releases/latest --jq .tag_name
```

次にregistryから新規導入し、配布manifestを検証する。

```bash
release_tmp="$(mktemp -d)"
npm install --prefix "$release_tmp" "vibepro@$VERSION"
"$release_tmp/node_modules/.bin/vibepro" runtime identity --json
```

照合条件:

- npm `version`が`VERSION`、`gitHead`が`RELEASE_SHA`
- 正本release planが要求するdist-tagが`VERSION`
- `refs/tags/v$VERSION`とGitHub Release targetが`RELEASE_SHA`
- GitHub Releaseの`isPrerelease`/Latest状態が正本分類と一致
- fresh installのruntime version、source commit、manifest、integrityが一致し`trusted`

### 7. 時間を段階別に記録する

merge時刻、npm registryのversion公開時刻、workflow完了時刻を記録し、次を混ぜない。

- pre-merge validation: 実装完了からmergeまで
- merge-to-npm: mergeからregistryでversionが見えるまで
- post-publish: npm公開後のGitHub Release/docs同期

速度改善を主張する時は同じ開始・完了条件のbefore/afterを使う。Issue #458の目標はmerge-to-npm 120秒以内であり、安全条件が欠ける実行はfallbackとして記録する。

## Exact-SHA Evidence Reuse

| 条件 | 判断 |
|---|---|
| PR head、必須CI、公開source treeが同一SHAで全成功 | release固有checkだけのfast path候補 |
| merge commitがreview済みtreeを保持し、package source bindingを証明できる | CI証拠を再利用可能 |
| CI欠落、失敗、pending、head不一致、証拠が古い | フル検証へfallback |
| merge後にpackage対象ファイルが変化 | フル検証へfallback |
| source/runtime/manifestがuntrustedまたは不明 | 公開停止 |

fast pathはworkflow実装がこの判定を機械検証する場合だけ使う。人間やエージェントが「たぶん同じ」と判断してstepを削除しない。

## Recovery

- npm publish前の失敗: 修正commitを作り、current headのCI/Reviewを取り直す。
- npm publish済み・dist-tag不一致: versionを再publishせず、正本planを確認して`npm dist-tag add vibepro@<version> <tag>`で収束させ、再照合する。
- npm publish済み・GitHub Release不一致: tag SHAを先に確認し、既存reconcile commandでRelease metadataを収束させる。tagを安易に削除しない。
- npm publish済み・docs失敗: 公開済みversionを保持し、docs projection/deployだけを再実行する。
- 誤version公開: `npm unpublish`や上書きを通常rollbackにしない。影響を評価し、deprecateとdist-tag復元を優先する。
- 認証、registry、GitHub APIのtimeout: 外部状態をread-onlyで再取得し、未確認と失敗済みを分ける。

## Common Rationalizations

- 「PRがmergeされたから公開済み」: mergeは公開トリガーであり、npm registryの証明ではない。
- 「workflowがgreenだから利用できる」: registry反映、gitHead、dist-tag、fresh installを別に確認する。
- 「同じテストだから全部省略できる」: exact-SHA bindingと機械的fast pathがない限り省略しない。
- 「失敗したversionをもう一度publishすればよい」: npm versionはimmutableであり、部分状態を照合して不足段階だけを収束させる。
- 「latestはnpm/GitHubが自動で正しく選ぶ」: npm dist-tagとGitHub Latestは別の外部状態であり、それぞれ正本分類と照合する。

## Red Flags

- `npm view`を確認せず公開完了と報告している。
- PR head、merge SHA、npm gitHead、Git tagのどれかが一致していない。
- `NPM_TOKEN`などsecret値をログへ出している。
- current head変更後に古いCIやreview証拠を使っている。
- prereleaseが意図せずGitHub Latestになっている、または古いstableの再実行でLatestが巻き戻っている。
- npm publish後のdocs失敗を「何も公開されていない」と扱い、同じversionを再publishしようとしている。
- dirtyな正本worktreeでversion bumpやrelease操作を始めている。

## Verification

Skill変更自体は次で検証する。

```bash
node bin/vibepro.js skills lint . --json
node --test --test-name-pattern='skills commands list install and verify bundled VibePro skills' test/vibepro-cli.test.js
cmp -s CLAUDE.md AGENTS.md
git diff --check
```

実際の公開ではRequired Workflowの外部照合をすべて実行し、version、release SHA、workflow run URL、npm/GitHub URL、runtime identity digestを最終報告へ残す。取得不能な面は`未確認`とし、成功へ読み替えない。

## Current Repository Rules

このSkillと既存のbundled Skillが矛盾する場合は、対象checkoutの`AGENTS.md`を優先する。特に、read-only archiveとなった`.vibepro/`へ新しいGate証跡を書かない。
