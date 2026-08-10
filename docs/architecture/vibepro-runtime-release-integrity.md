# VibePro Runtime Release Integrity Architecture

## Decision

VibeProの開発runtimeと利用runtimeを分離する。利用runtimeは、公開済みexact npm versionをcanonical launcherから起動し、packageに同梱した`runtime-manifest.json`でsource commitを証明する。開発runtimeは`VIBEPRO_RUNTIME_MODE=development`を明示したGit checkoutであり、観測とdoctorにだけ使える。verify evidenceまたはPR judgmentは生成できない。

## Runtime identity

`runtime_identity`は次を持つ。

- package: name、exact_version、root
- cli: resolved entrypoint、invoked alias、runtime module
- source: `npm_package | git_checkout | unverified_package`
- release manifest: package.json digest、source Git commit、origin/main relation、dirty=false
- live Git: commit、dirty、origin URL、origin/main commit/relation
- integrity: `trusted | blocked`、`runtime_mismatch | stale_runtime`、purpose、reasons
- identity digest:時刻とlauncher aliasを除いたidentityのSHA-256

## Trust matrix

| Runtime | Observation | Evidence / PR judgment |
|---|---:|---:|
| Valid manifested npm package | allow | allow |
| Current Git + explicit development | allow | block: runtime_mismatch |
| Behind/diverged Git, dirtyを含む | block: stale_runtime | block: stale_runtime |
| Manifest missing/mismatch | block: runtime_mismatch | block: runtime_mismatch |

## Guard placement

GuardはCLI表示層だけでなく、`runVerificationCommand`、`recordVerificationEvidence`、CI import、`preparePullRequest`のlibrary境界に置く。外部command実行、mkdir、artifact write、doctor fixより前に評価する。PR prepareは現在のruntimeに加え、既存verification commandごとのidentityを再評価する。

## Release provenance

`prepack`はcleanかつorigin/mainとsame/aheadのGit checkoutでのみmanifestを生成する。manifestはpackage name/version、package.json SHA-256、entrypoint、source commit/origin/relationを含む。npm registryの`dist.integrity`と`dist.shasum`はtarball公開後に`npm view vibepro@<exact>`で外部照合する。

## Consumer convergence

canonical launcherはmoving dist-tagやsource pathではなくexact npm versionへ固定する。Brainbase pre-pushは同じlauncherを実行し、`runtime identity --json`のtrusted判定後にPR preparationへ進む。切替はpackage公開とregistry照合の後にatomicに行い、旧wrapperはその前に削除しない。
