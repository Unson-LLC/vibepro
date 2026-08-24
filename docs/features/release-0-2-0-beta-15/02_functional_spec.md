# Functional Spec: VibePro 0.2.0-beta.15 release

- Story: `story-vibepro-release-0-2-0-beta-15`
- Release source PR: `#489`
- Included merge SHA: `877dd461695edb52e138a811078551705799d433`
- Current base: `bf2ed3f591be098d2f7c9f9180a824547fcb246e`

## REL15-C-001: version consistency

`package.json`、`package-lock.json`、lockfile root package、CLI versionは
`0.2.0-beta.15`でexact一致する。beta.14 pin、wrong version、lock mismatchはtest failureになる。

## REL15-INV-001: focused release boundary

release差分はStory・Architecture・Spec・Task、version metadata、版番号回帰testだけである。
製品コード、workflow、依存、`.vibepro` runtime artifactは変更しない。

## REL15-INV-002: immutable source

beta.15のsourceはPR #489 merge SHAを含むcurrent baseである。beta.14のStoryやrelease sourceを
beta.15の証拠として流用しない。

## REL15-S-001: validation and later convergence

準備commitのexact HEADでtargeted release tests、typecheck、`npm pack --dry-run`、full suiteを行う。
merge後の公開面はnpm、dist-tag、Git tag、GitHub prerelease、fresh install、docsを同一SHAへ照合する。
