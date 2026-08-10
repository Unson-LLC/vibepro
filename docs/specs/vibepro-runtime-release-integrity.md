# Spec: VibePro Runtime Release Integrity

Story: `story-vibepro-runtime-release-integrity`

## Contracts

### SPEC-RUNTIME-1 Identity command

`vibepro runtime identity --json`は`runtime_identity` objectをstdoutへ出す。trustedならexit 0、blockedならexit 2とする。

Code refs: `src/runtime-info.js`, `src/cli.js`

Test refs: `test/runtime-info.test.js`

### SPEC-RUNTIME-2 Fail-closed policy

通常モードのGit checkout、manifest不在/不一致、想定外entrypointを`runtime_mismatch`とする。origin/mainよりbehindまたはdivergedのGit checkoutをdirtyに関係なく`stale_runtime`とする。development modeは観測のみ許可する。

Code refs: `src/runtime-info.js`, `src/doctor.js`

Test refs: `test/runtime-info.test.js`, `test/verification-runner.test.js`

### SPEC-RUNTIME-3 Evidence binding

verify run JSONとverification evidence commandへidentityを記録する。PR prepare/create JSONとPR bodyへ現在およびevidence runtime identityを記録する。欠落/blocked identityが1件でもあればPR artifactを書かない。

Code refs: `src/verification-runner.js`, `src/verification-evidence.js`, `src/pr-manager.js`

Test refs: `test/verification-runner.test.js`, `test/pr-manager.test.js`

### SPEC-RUNTIME-4 Immutable release provenance

pack時にclean current sourceから`runtime-manifest.json`を生成してnpm tarballへ含める。versionはexactで一致し、package.json digest、entrypoint、source commit、origin URL、origin/main relationを検証する。公開後identityはnpm registryのexact version、gitHead、dist.integrity、dist.shasumで確認する。

Code refs: `scripts/runtime-manifest.mjs`, `package.json`

Test refs: pack/install smokeと`npm view vibepro@<exact> ... --json`

### SPEC-RUNTIME-5 Canonical consumers

`command -v vibepro`とBrainbase pre-pushは同じcanonical launcherを解決し、同じidentity digestを報告する。launcherは公開済みexact npm versionへ固定する。公開前package、source checkout、dirty runtimeは利用しない。

Consumer refs: `~/.local/bin/vibepro`, Brainbase `.husky/pre-push`
