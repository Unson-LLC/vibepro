---
name: vibepro-npm-publish
description: VibeProのnpm公開、release PR、post-merge release、dist-tag、GitHub Release、公開後docs同期を扱う時に使う。共通公開契約はnpm-package-publish Skillを先に読み、このSkillはVibePro固有値だけを与える。
---

# VibePro npm Publish Adapter

## Purpose

`npm-package-publish`へVibePro固有の公開profileを渡す薄いadapter。共通の安全条件、exact-SHA照合、部分失敗、復旧手順はここへ複製しない。

## When to Use

VibeProのrelease PR、npm公開、post-merge workflow監視、dist-tag/GitHub Release/docsの照合や復旧に使う。一般的なnpm公開だけなら共通Skillを使う。

## Required Skill

最初に`npm-package-publish`を読む。見つからない場合は公開操作を始めず、brainbase-unsonの`.claude/skills/npm-package-publish`をSkill配布経路から導入する。

## Release Profile

| Key | Value |
|---|---|
| `repository` | `Unson-LLC/vibepro` |
| `package` | `vibepro` |
| `default_branch` | `main` |
| `version_source` | `package.json` |
| `release_workflow` | `.github/workflows/post-merge-release.yml` |
| `release_plan` | `node scripts/post-merge-release.mjs plan --event <merged-pr-event.json>` |
| `targeted_checks` | 下記「VibePro checks」 |
| `fresh_install_check` | 隔離先へ`vibepro@<version>`を導入し、`vibepro runtime identity --json`を実行 |
| `product_convergence` | runtime identity、GitHub Release、VitePress/docs同期、release history |

## VibePro Checks

```bash
node --test test/post-merge-release.test.js test/github-release-convergence.test.js
npm run typecheck
npm pack --dry-run
```

source変更を含む、またはexact-SHAへ結び付いた全体証拠がない場合:

```bash
node --test --test-concurrency=2
```

Skill自体を変更した場合:

```bash
node bin/vibepro.js skills lint . --json
node --test --test-name-pattern='skills commands list install and verify bundled VibePro skills' test/vibepro-cli.test.js
cmp -s CLAUDE.md AGENTS.md
git diff --check
```

## Required Workflow

1. `npm-package-publish`を読み、このprofileの全keyを渡す。
2. 対象checkoutの`AGENTS.md`で現行Gitフローを確認する。
3. VibePro checks、current-head CI、merge後workflowを順に検証する。
4. VibePro Convergenceを同じrelease SHAへ収束させる。

## VibePro Convergence

- prerelease/stable、npm dist-tag、GitHub ReleaseのLatest分類は`release_plan`を正本にする。一般的なSemVer知識だけで決めない。
- merge後は`post-merge-release.yml`をmerge SHAへ結び付けて監視する。
- npm `gitHead`、`refs/tags/v<version>`、GitHub Release target、fresh installのruntime source commitを同じrelease SHAへ揃える。
- fresh installのruntime identityはversion、source commit、manifest、integrityが一致して`trusted`であることを確認する。
- npm公開後にVitePress/docs同期だけが失敗した場合は`published_but_docs_failed`として扱い、同じversionを再publishしない。
- merge-to-npmの時間とpost-publishのdocs時間を分ける。速度改善は同じ開始・完了条件で比較する。

## Repository Boundary

対象checkoutの`AGENTS.md`を優先する。VibePro repo自身の開発フローが変更された場合、このadapterから古いPR/Gate手順を復活させない。

## Common Rationalizations

- 「VibeProだけは共通契約を飛ばせる」: 製品固有差分はadapterにあるが、公開完了条件は共通Skillに従う。
- 「docsが失敗したから同じversionを再publishする」: npmとdocsを部分状態として分離する。

## Red Flags

- `npm-package-publish`を読まず、このadapterだけで公開している。
- release planではなく推測でdist-tagやLatestを決めている。
- runtime identityまたはdocs同期の未確認を公開完了へ丸めている。

## Verification

VibePro ChecksのSkill lint、bundled Skill test、mirror比較、diff checkを実行する。実公開時は共通Skillの外部照合とVibePro Convergenceを両方満たす。
