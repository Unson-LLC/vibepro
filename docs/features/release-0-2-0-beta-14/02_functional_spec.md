# Functional Spec: VibePro 0.2.0-beta.14 release

- Story: `story-vibepro-release-0-2-0-beta-14`
- Scope: release metadata only

## C-001 Version consistency

`package.json`と`package-lock.json`のroot packageは`0.2.0-beta.14`を宣言する。

- AC: `REL14-AC-001`
- Code: `package.json`, `package-lock.json`
- Test: `node -p "require('./package.json').version"`

## INV-001 Focused release surface

release commitはStory、Spec、catalog、version metadataだけを変更し、`src`、`bin`、依存、公開workflowの挙動を変更しない。

- AC: `REL14-AC-002`
- Verification: `git diff --name-only origin/main...HEAD`

## V-001 Exact-head validation

公開関連テスト、typecheck、package dry-run、必須CIをrelease headへ結び付ける。証拠が欠落・失敗・古い・不一致ならfull validationへfallbackする。

- AC: `REL14-AC-003`
- Code: `.github/workflows/post-merge-release.yml`, `scripts/post-merge-release.mjs`
- Test: `test/post-merge-release.test.js`, `test/github-release-convergence.test.js`

## INV-002 Public surface convergence

公開完了はnpm `gitHead`、`beta` / `latest` dist-tag、Git tag、GitHub prerelease target、fresh install runtime、docs投影をrelease merge commitへ照合して判定する。

- AC: `REL14-AC-004`, `REL14-AC-005`
- Code: `scripts/post-merge-release.mjs`
- Evidence: GitHub Actions、npm registry、GitHub Release、公開マニュアル
