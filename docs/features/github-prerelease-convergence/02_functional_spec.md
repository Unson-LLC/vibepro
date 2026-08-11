<!-- vibepro-projection story_id=story-vibepro-github-prerelease-convergence feature_slug=github-prerelease-convergence ownership=generated profile=feature_packet source=.vibepro/spec/story-vibepro-github-prerelease-convergence/spec.json source_sha256=6093fbcb84cf016cadd833f2112a2c40b0d9e27535acb91a88810b36e50386f0 renderer=functional_spec_markdown@1 direct_edit=false -->
- Canonical ownership: generated

# Functional Spec

- Story: story-vibepro-github-prerelease-convergence
- Status: -
- Clauses: 5

## INV-002

有効なSemVerのGitHub Release分類は、プレリリースならprerelease=trueかつlatest=false、安定版ならprerelease=falseで、現在のLatest以下でない場合だけlatest=trueである。

### Origin refs

- {"anchor":"releaseClassification","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-1 derives GitHub classification from SemVer and rejects invalid versions","file":"test/github-release-convergence.test.js"}
- {"case":"GRC-S-2 Latest lookup handles absence and fails closed on malformed tags or API errors","file":"test/github-release-convergence.test.js"}
- {"file":"docs/architecture/story-vibepro-github-prerelease-convergence.md","section":"正規化契約"}
- {"index":0,"kind":"acceptance_criteria"}
- {"index":1,"kind":"acceptance_criteria"}

## S-001

Releaseが未作成または既存のとき、reconcile-github-releaseはcreateまたはeditへ同じ明示フラグを渡して期待メタデータへ収束させる。

### Origin refs

- {"anchor":"reconcileGithubRelease","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-2/GRC-S-3/GRC-S-6 create and edit converge prerelease and stable metadata","file":"test/github-release-convergence.test.js"}
- {"file":"docs/architecture/story-vibepro-github-prerelease-convergence.md","section":"収束処理"}
- {"index":2,"kind":"acceptance_criteria"}

## S-002

GitHub Release操作後のtagが期待commit SHAと異なるとき、reconcile-github-releaseは非0で失敗する。

### Origin refs

- {"anchor":"verifyReleaseTag","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-4 fails closed when the post-operation tag SHA differs","file":"test/github-release-convergence.test.js"}
- {"index":4,"kind":"acceptance_criteria"}

## S-003

GitHub Release操作後のtagName、targetCommitish、isPrerelease、latest tagのいずれかが期待値と異なるとき、reconcile-github-releaseは非0で失敗する。

### Origin refs

- {"anchor":"metadata did not converge","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-5 fails closed when GitHub metadata does not converge","file":"test/github-release-convergence.test.js"}
- {"index":5,"kind":"acceptance_criteria"}

## S-004

より新しい安定版がGitHub Latestのとき、古い安定版のcreateまたはeditを再実行してもLatestは新しい安定版のまま維持される。

### Origin refs

- {"anchor":"releaseClassificationForCurrentLatest","file":"scripts/post-merge-release.mjs"}
- {"case":"GRC-S-3b replaying an older stable release never rolls Latest backward","file":"test/github-release-convergence.test.js"}
- {"file":"docs/architecture/story-vibepro-github-prerelease-convergence.md","section":"収束処理"}
- {"index":3,"kind":"acceptance_criteria"}

## Diagrams

- none
