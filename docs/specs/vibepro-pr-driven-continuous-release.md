---
story_id: story-vibepro-pr-driven-continuous-release
title: PR-driven Continuous Release Spec
parent_design: pr-driven-continuous-release
code_refs:
  - scripts/post-merge-release.mjs
  - src/pr-manager.js
  - .github/workflows/post-merge-release.yml
test_refs:
  - test/post-merge-release.test.js
diagrams:
  - kind: state
    entities:
      - merged_pr
      - docs_deploy
      - package_release
    mermaid: |
      stateDiagram-v2
        [*] --> merged_pr
        merged_pr --> docs_deploy: project notes and deploy VitePress
        merged_pr --> package_release: version increased
        merged_pr --> [*]: version unchanged
        package_release --> [*]: reconcile Release and npm at merge SHA
        docs_deploy --> [*]
  - kind: threat_model
    mermaid: |
      flowchart LR
        A[Untrusted PR markdown] --> B[Bounded parser without evaluation]
        B --> C[Generated documentation]
        D[GitHub secrets] --> E[Workflow environment only]
        E --> F[npm and Cloudflare APIs]
        G[Later main commits] --> H[Exact event merge SHA binding]
        I[Existing npm version] --> J{gitHead matches?}
        J -->|Yes| K[Reconcile tags]
        J -->|No| L[Fail without overwrite or delete]
---

# Spec

- `PCR-CON-001`: Release Notesは `Change Summary`、`Compatibility`、`User Action` の3節を持ち、空節は `なし` になる。
- `PCR-CON-002`: note identityはPR番号で、同じeventの再処理は既存markerを置換して重複しない。
- `PCR-CON-003`: note metadataはnumber/title/author/merged_at/merge_commit_sha/html_urlをevent payloadから取得する。
- `PCR-CON-004`: version gateはbaseとmergeのSemVerを比較し、厳密な増加時だけreleaseする。
- `PCR-CON-005`: alphaは `alpha`、betaは `beta` と `latest`、stableは `latest` を設定する。
- `PCR-CON-006`: 公開済みnpm versionは期待SHAと `gitHead` が一致する場合だけ成功として再利用する。
- `PCR-CON-007`: registry readは有限回の指数backoffを使い、timeout時は修復可能な不一致として失敗する。
- `PCR-CON-008`: workflowはdocs commitとCloudflare deployを最新mainへ結び、Release/npmはeventのmerge commitへ固定し、version不変時は後二者をskipする。
