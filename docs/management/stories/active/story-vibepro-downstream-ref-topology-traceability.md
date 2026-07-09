---
story_id: story-vibepro-downstream-ref-topology-traceability
title: "downstream repo の ref topology を PR artifact に固定し、decision record 空の story に used-for-decision summary を出す"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "2026-07-09 の価値監査で、SalesTailor の origin/* と salestailor-inc/* の branch topology ズレにより ref 決め打ちだと src/test が 0 に見える誤監査リスクが確認され、BFD-230 は decision-records 空のまま verification import が判断の本体だった"
related_stories:
  - story-vibepro-canonical-audit-diff-stats
  - story-vibepro-traceability-evidence-promotion
  - story-vibepro-audit-automation-memory-guard
parent_design: vibepro-downstream-ref-topology-traceability
architecture_docs:
  - docs/architecture/vibepro-downstream-ref-topology-traceability.md
spec_docs:
  - docs/specs/story-vibepro-downstream-ref-topology-traceability.md
created_at: 2026-07-09
updated_at: 2026-07-09
reason: "alternatives considered: document the multi-remote pitfall in the audit automation prompt only (the audit already does this and it still costs a manual reconstruction every run), extend resolveBaseRef to scan all remotes automatically (changes base selection behavior for every repo and risks picking a wrong mirror base), or persist a read-only ref-topology snapshot into the PR artifact directory at pr prepare time plus a derived used-for-decision summary when decision records are empty; selected persist-and-summarize. compatibility impact: resolveBaseRef preference order and buildPrFreshnessState are unchanged; ref-topology.json and the used-for-decision summary are additive artifacts; no gate semantics change. rollback plan: revert the ref-topology collector, the summary builder, their pr prepare wiring, this Story, the spec, and design-ssot links in one commit; existing artifacts remain valid without them. boundary and scope: the topology snapshot records what remotes/refs looked like at prepare time and which base was chosen by which rule; it never changes base selection, never fetches remotes, and the summary only restates existing evidence-to-judgment links — it cannot create, upgrade, or substitute evidence. accepted followups: none for this PR."
---

# Story

VibePro が downstream repo（SalesTailor 等）で使われるとき、mirror / upstream / Inc 側 remote が混在し、同名 branch が remote ごとに異なる SHA を持つ。2026-07-09 の監査では `codex/bfd230-recipient-proper-nouns` が `origin` にのみ存在し、`codex/bfd-230-timerex-cta-materialization` は両 remote に異 SHA で存在した。現行の `resolveBaseRef` は `origin/develop → origin/main → develop → main → master` の固定優先リストで、選定根拠も remote ごとの見え方も artifact に残らない。監査は毎回 `git remote -v` / `git branch -r` から topology を再構成しており、ref を決め打ちすると「src/test が 0 に見える」誤監査が起きる。

また BFD-230 では `decision-records.json` が空のまま、`verify import-ci` による current-head bind の verification evidence が PR readiness と merge 判断の本体だった。gate DAG 上は正しい（decision record は特定 blocker が要求する時だけ必須）が、監査・handoff の視点では「decision log が無い story で何が判断を支えたか」を毎回 gate 構造から逆算する必要がある。

2 つとも prepare 時に数行の artifact を固定すれば解ける: (1) `pr prepare` が **ref-topology snapshot** を保存する — remote 一覧、base/head/story branch の remote ごとの存在と SHA、採用した base_ref とその選定ルール、同名 branch の remote 間乖離。(2) accepted decision が 0 件の story では、**used-for-decision summary** を導出する — どの verification evidence（imported CI 含む）がどの readiness / axis / merge 判断を支えたかの機械可読マップ。

## User Story

**As a** downstream repo の VibePro story を後日監査・handoff で再構成する automation / operator<br>
**I want** prepare 時点の ref topology と、decision record 非依存の judgment-支持 evidence マップが PR artifact に固定されていること<br>
**So that** ref 選定ミス由来の誤監査を機械的に検出でき、decision log の無い story でも used-for-decision を artifact だけで説明できる

## Scope

- `ref-topology.json`: `pr prepare` が `.vibepro/pr/<story-id>/` に保存する read-only snapshot。内容は remote 一覧（name/url 種別）、base 候補・head・story branch それぞれの remote ごとの解決結果（存在有無・SHA）、採用 base_ref と選定理由（explicit option / origin HEAD / preference list の何番目か）、同名 branch が remote 間で異 SHA の場合の divergence フラグ。git へのネットワークアクセス（fetch）は行わず、ローカルに既知の ref のみを読む。
- `used-for-decision` summary: `pr prepare` 完了時、accepted decision が 0 件の story に限り、gate 評価が実際に消費した verification evidence（kind・current-head binding・imported CI かどうか）と、それが解決した axis / gate / readiness 判定の対応を `pr-prepare.json` 内の `used_for_decision` セクションとして導出する。既存の evidence と gate 結果の再掲であり、新しい判定は作らない。
- 監査互換: 両 artifact は `vibepro audit session-cost` / execute merge の監査経路から追加取得なしで読める場所・スキーマにする。
- 事前宣言する数値目標: (1) 2 remote・異 SHA 同名 branch の synthetic repo で divergence が snapshot に現れる、(2) base 選定の理由が「どのルールで選ばれたか」まで機械可読で残る、(3) decision-records 空 + CI import 済みの synthetic story で `used_for_decision` が evidence→判断の対応を最低 1 件含む。

## Acceptance Criteria

- [ ] DRT-S-1: 複数 remote を持つ synthetic repo で `pr prepare` を実行すると、`ref-topology.json` に全 remote と base/head/story branch の remote ごとの SHA 解決結果が保存される。
- [ ] DRT-S-2: 同名 branch が remote 間で異なる SHA を持つ場合、該当エントリに divergence フラグと両 SHA が記録される。
- [ ] DRT-S-3: 採用 base_ref には選定根拠（explicit / origin HEAD / preference list 順位）が機械可読で付く。既存の `resolveBaseRef` の選定結果自体は変化しない。
- [ ] DRT-S-4: accepted decision が 0 件で verification evidence（imported CI 含む）が存在する story では、`pr-prepare.json` に `used_for_decision` セクションが出力され、各 evidence がどの axis/gate/readiness 判定に消費されたかを列挙する。
- [ ] DRT-S-5: accepted decision が 1 件以上ある story では `used_for_decision` セクションは生成されず、既存の decision-index 経路が正本のまま変化しない。
- [ ] DRT-S-6: snapshot 取得の失敗（remote なし・detached HEAD 等）は `ref-topology.json` に理由付き partial として記録され、`pr prepare` 本体と gate 評価は従来どおり完了する。

## 既存挙動（inherited behavior）

- `resolveBaseRef` preference order (origin/develop, origin/main, develop, main, master) and explicit `--base` override behavior are unchanged/existing.
- `buildPrFreshnessState` base/head freshness semantics and remediation commands are unchanged; the topology snapshot is additive alongside it.
- CI evidence import head-SHA matching and pass-only recording rules are unchanged; the summary consumes recorded evidence as-is.
- Gate evaluation and decision-record requirements per axis blocker are unchanged.

## Non Goals

- base 選定アルゴリズムの変更・自動 remote スキャン（snapshot は観測のみ）。
- remote への fetch / ネットワークアクセスの追加。
- decision record の自動生成（summary は既存 evidence の再掲であり、decision の代替ではない）。
- 監査 automation prompt 側の変更（artifact が増えれば prompt は単純化できるが、それは automation 定義側の作業）。

## Runtime Evidence

- current_reality: 変更は ref-topology collector と used-for-decision summary builder の新設、`pr prepare` への配線、multi-remote synthetic repo fixture を使った focused tests のみ。ネットワークアクセス・新規 CLI コマンド・デプロイ経路は追加しない。
- failure_modes: topology 取得失敗は partial 記録に留まり prepare を止めない。summary の導出は既存 gate 評価結果の read-only 再掲なので、導出バグは artifact の欠落・不正確として現れ、gate verdict には影響しない。
