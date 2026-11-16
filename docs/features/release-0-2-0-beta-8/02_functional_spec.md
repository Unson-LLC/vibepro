# Functional Spec: VibePro 0.2.0-beta.8 release

- Story: `story-vibepro-release-0-2-0-beta-8`
- Scope: release metadata only

## C-001 Version consistency

`package.json`と`package-lock.json`のroot packageは`0.2.0-beta.8`を宣言し、
CLIのversion出力も同じ値へ解決される。

- AC: `REL8-AC-001`
- Code: `package.json`, `package-lock.json`
- Test: `test/vibepro-cli.test.js` の `--version prints the package version`

## INV-001 Focused release surface

release commitはStory、Spec、catalog、version metadataだけを変更し、`src`、`bin`、
依存、公開workflowの挙動を変更しない。

- AC: `REL8-AC-002`
- Verification: `git diff --name-only origin/main...HEAD`

## S-001 Exact-SHA validation selection

version-bump PRの必須CI、reviewed head、公開sourceが同一SHAへ結び付く場合だけfast pathを
選ぶ。証拠が欠落・失敗・古い・不一致ならfull validationへfallbackする。

- AC: `REL8-AC-003`
- Code: `.github/workflows/post-merge-release.yml`, `scripts/post-merge-release.mjs`
- Test: `test/e2e/story-vibepro-release-exact-sha-fast-path.test.js`

## INV-002 Public surface convergence

公開完了はnpm `gitHead`、`beta` / `latest` dist-tag、Git tag、GitHub prerelease target、
fresh install runtimeをrelease merge commitへ照合して判定する。

- AC: `REL8-AC-004`
- Code: `scripts/post-merge-release.mjs`
- Test: `test/post-merge-release.test.js`, `test/github-release-convergence.test.js`

## OBS-001 Timing

merge時刻とnpm registryの公開時刻からmerge-to-npmを計算し、Issue #458の120秒目標を
同じ開始・完了条件で評価する。

- AC: `REL8-AC-005`
- Evidence: GitHub Actions summary、npm registry `time`
