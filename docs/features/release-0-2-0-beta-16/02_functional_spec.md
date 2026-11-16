# Functional Spec: VibePro 0.2.0-beta.16 release

- Story: `story-vibepro-beta16-release`
- Release source PRs: `#491`, `#492`, `#494`
- Included merge SHAs: `e9385b9846932a37456d62cf85f5ed6092eeec91`, `495b7fbc2724bd13c3f9d82c80b916dd4dd782e8`, `feb4426600ddb48ec91fdd0bbbb47eca18915601`
- Current base: `3db04f430fe017aef42a456ef6c18434ad8b4407`

## REL16-C-001: version consistency

`package.json`、`package-lock.json`、lockfile root package、CLI versionは
`0.2.0-beta.16`でexact一致する。beta.15 pin、wrong version、lock mismatchはtest failureになる。

## REL16-INV-001: focused release boundary

release差分はStory・Architecture・Spec・Task、version metadata、版番号回帰testだけである。
製品コード、workflow、依存、既存Story、`.vibepro` runtime artifactは変更しない。

## REL16-INV-002: immutable source lineage

beta.16のsourceはPR #491、PR #492、PR #494のmerge SHAおよび各release history投影を含むcurrent baseである。
beta.15のStoryやrelease sourceをbeta.16の証拠として流用しない。

## REL16-S-001: validation and later convergence

準備commitのexact HEADでtargeted release tests、version test、typecheck、`npm pack --dry-run`、full suiteを行う。
merge後の公開面はnpm、dist-tag、Git tag、GitHub prerelease、fresh install、docsを同一SHAへ照合する。
