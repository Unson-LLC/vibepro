---
story_id: story-vibepro-atomic-scope-review-contract
title: Atomic Scope Review Contract Architecture
status: designed
---

# Atomic Scope Review Contract Architecture

## Decision

自動split計画は正本として常に生成し、`atomic_single_pr`はそれを削除するoverrideではなく、同じlaneを一つのcurrent HEAD上で累積検証するための型付き例外とする。例外の裁定はStory宣言、生成lane、scope安全性、current-head agent review ownership、verification target bindingを結合してfail-closedに行う。

## Boundary

`src/pr-manager.js`が次の順序で裁定する。

1. changed filesからlaneとautomatic recommendationを生成する。
2. Story登録を`.vibepro/config.json`へ永続化し、そのrepo-control変更も独立laneとして扱う。Storyの`pr_scope_strategy`、監査説明である80文字以上の`pr_scope_reason`、全laneを列挙する`pr_scope_review_facets`、`from->to`形式の`pr_scope_dependency_boundaries`を検証する。依存辺は既知lane間だけを許可し、自己辺・未知lane・切断グラフを拒否する。自由文中のlane名一致は依存関係の証明に使わない。
3. scope評価時に`dirty_review_surface`、`mixed_repo_control_surface`、`empty_commit_message`を型付きsignalとして生成し、表示文言のregex判定に依存しない。混在repo-controlのうち、Story登録の正本である`.vibepro/config.json`だけはtyped facet、依存辺、strict current-head owner mapが揃う場合に限りatomic reviewへ委ねる。CI、package、agent設定など独立してrelease可能なrepo-controlは引き続きunsafeとし、宣言で上書きさせない。複数commitは件数だけで汚染と断定せず、commit messageから抽出したStory/STR/BFD/BUG/INC参照を現在のStory IDと比較する。現在Storyの`-vN`参照だけは、commitが2親以上の実mergeで、sourceが`origin/codex/<story-vN>`、targetが同じ`codex/<story-vN>`、かつsource remote-tracking refがmerge parentへ解決される場合に限りcurrent lineageとして受理する。受理時はreference、full commit SHA、parent count、source/target ref、resolved remote SHA、`merge_topology_canonical_ref_and_title` basisをsignalに保存し、scope reasonと構造化signalをbounded summary、human review、PR body、split plan、gate DAG、HTML reportへ伝播する。titleだけ、単一親、missing/mismatched refはforeign lineageとしてfail-closedにする。別work itemの明示的lineageがあれば`multiple_commits_foreign_story_lineage`をunsafeとして生成し、なければ`multiple_commits_scope_contamination_risk`をreview必須だがoverride可能なsignalとして保持する。file数超過もreviewability adviceであり、atomic override不能なunsafe signalとは分ける。
4. strict current-head review artifactからrequired/checkpoint-required roleだけを抽出してowner mapを照合する。optional roleはmissingでも拒否せず、passingでもfacet ownerに採用しない。各laneの全changed pathをpassing required roleのinspection surfaceへ対応付け、過去HEAD、content-scopedだけのreview、別laneだけを見たreview、未close required reviewは採用しない。`separate_session`は自己申告relationや任意IDとして信用せず、同一role・agent・agent systemの最新lifecycleがclosedで、そのthread/session IDとrecordが一致し、implementation session IDと異なるprovenanceだけをowner evidenceへ昇格する。より新しいrunning lifecycleがあれば古いclosed lifecycleは無効である。timeout/manual shutdownからのrecoveryは、旧lifecycleを証跡付きでcloseし、`replacement_for`付きでreplacementをstartし、同一replacement agent/thread/sessionをcloseとrecordまで再利用し、recordへtranscriptとclose evidenceを付ける実行順序を生成する。
5. accept時だけ各laneを`cumulative_atomic_head`へ写像し、全required commandをfinal validationへ残す。
6. split planのaccept結果で同じprepareのGate DAGを再調停する。自動split推奨がある一方でscope自体はreviewableなため`gate:split_resolution`が未生成ならnodeとroute/body edgeを補完し、`gate:pr_scope_judgment`と`gate:split_resolution`をpassへ更新して`summary.needs_evidence_count`と`overall_status`を再計算する。split planだけが`single_pr_ok`でGate DAGのnode、summary、readiness表示がblockする二重正本を許さない。
7. failure-mode分類では、facet列挙、型付き依存辺、連結性を検証するatomic宣言そのものをschema/validation境界として扱う。coverageにはcurrent-boundかつpassした実行command、構造化observation、対象path、scenario/value上のfailure assertionを要求し、target名や失敗したcommandにmode keywordがあるだけではcoverしない。一方、review `role`やresponsibility authorityはgovernance上のownershipであり、authentication/authorization、permission、security、credential等の実境界がない限り`auth_denied`候補へ昇格しない。
8. change-risk分類は`gate_orchestration`と`review_lifecycle`が同じ変更surfaceに共存するときだけ`workflow_heavy`へ昇格する。gate-onlyまたはreview-onlyの変更は既存profileを維持し、atomic policy追加による過剰gate拡大を防ぐ。

自動split案、lane、rejection reasonはaccept時も監査可能なまま保持する。これにより例外を「分割不要」という情報消失ではなく、「分割facetを同じHEADで誰がどう確認したか」というpositive evidenceへ変える。

## Verification Evidence Boundary

path-surface gateのstructured observationは、scenario/valueのsurface語だけでは十分でない。`observation.targets[]`が全changed pathのそれぞれ、またはその親directoryを指す場合だけ当該surfaceをcoverする。free-form legacy evidenceの互換読取はatomic metadataを持たないStoryだけに限定し、atomic Storyではtarget未束縛のkeyword evidenceを採用しない。`.vibepro/config.json`は生成artifactではなくtracked control-plane sourceなのでcontent binding対象に含めるが、他の`.vibepro/*`証跡はreview surfaceから除外する。

一時worktreeや生成artifactを失って復旧した場合、過去のreview/evidenceを現在状態へ暗黙継承しない。Story/Specを再登録し、current HEADで検証を再実行し、`gate_evidence`と`release_risk`の各final reviewerが全generated laneのchanged pathをinspection inputとして所有してからowner mapを再構成する。両reviewがclose・recordされるまではatomic scopeを`rejected`に保ち、完了後の同一prepareでのみ`accepted`へ再調停する。

responsibility authority resolverは、required evidenceへ複数のcurrent commandが一致するとき、対象responsibilityのcontract clause IDを含むcommandを優先する。scenario名だけ一致するatomic scope replayを、別contractのauthority証跡として先着順に採用しない。このresolver境界はatomic owner-mapの入力を正しく保つためのruntime依存であり、既存authority registryのfail-closed validationは変更しない。

## Compatibility and Rollback

Storyが`atomic_single_pr`を要求しない場合は従来のautomatic split判定をそのまま使う。例外導入をrollbackしてもsplit planのschemaとlane情報は保持できる。既存review artifactをcurrent HEADのowner evidenceへ自動昇格しない。
`gate_orchestration`と`review_lifecycle`の複合変更だけをheavyにする既存分類境界も維持する。rollback時はatomic判定を除去しても単独surfaceのprofileをheavyへ広げない。

## Release Operations

この変更にデータmigration、feature flag、常駐processの再起動はない。release ownerはVibePro maintainerであり、PR merge後に通常のpackage releaseへ載せる。段階導入は次の順序で行う。

1. PRのcurrent HEADで`pr prepare`、required review、adjudication、CIを完了し、`atomic_scope.status = accepted`と全changed pathを持つ`owner_map`を確認する。
2. merge後のcanonical `main`でmetadataなしStoryと小規模PRの回帰を実行し、既存automatic splitが変わらないことを確認する。
3. 最初の`atomic_single_pr`利用Storyをcanaryとし、`pr-prepare.json`、`split-plan.json`、Gate DAGで同じaccepted reason、typed lineage、lane集合が再構成できることを確認する。
4. `atomic_scope.status = accepted`なのにowner mapの未所有pathが1件でもある、unsafe signalがある、またはscope/split Gateがpassでない場合はrolloutを中止する。

owner-visible observabilityの正本は各Storyの`.vibepro/pr/<story-id>/pr-prepare.json`、`split-plan.json`、`gate-dag.json`である。maintainerはcanaryと以後のatomic PRで、`atomic_scope.status`、`rejection_reasons`、owner mapの未所有path数、typed unsafe signal、accepted current-story lineageを確認する。期待しないacceptance、artifact間のstatus不一致、owner未所有pathが1件以上ならrelease incidentとしてPRをblockし、対象Story ID、HEAD SHA、3 artifactのpathをVibePro maintainerへ引き渡す。

rollback triggerは、期待しないatomic acceptance、既存non-atomic Storyのsplit挙動変更、artifact間のaccepted/rejected不一致、またはrollback不能なowner-map欠落である。trigger時はrelease commitを`git revert <release-merge-sha>`でrevertし、再度`node bin/vibepro.js pr prepare . --story-id <canary-story-id> --base origin/main --view blocking-gates --json`を実行する。復帰確認ではlegacy automatic split recommendationとlaneが残ること、atomic Storyがacceptedへ昇格しないこと、metadataなしStoryの既存fixtureがpassすることを確認する。revertまたは復帰確認が失敗した場合は追加mergeを止め、artifact一式と失敗commandをVibePro maintainerへescalateする。

pre-merge rollback rehearsalは、metadataなしStoryのlegacy surface signal、小規模PRのlegacy readiness、atomic scopeに対するlegacy keyword evidence拒否、current-HEAD owner evidence不足時のautomatic split継続を同一focused integrationで確認する。このrehearsalは互換性とfail-closed behaviorの証拠であり、まだ存在しないrelease merge commitをrevertした証拠とは扱わない。post-mergeのcanonical `main` canaryと、incident時の実`git revert`はrelease ownerが上記手順で実施する別の運用境界である。
