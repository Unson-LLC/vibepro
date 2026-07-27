---
story_id: story-vibepro-enumeration-coverage-gate
title: 網羅範囲(enumeration)の証跡をGateで必須化し、instance単位の修正closureを止める
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "story-vibepro-review-token-accounting-closure で6ラウンド・high severity 10件のうち6件が前ラウンドの修正自身が作り込んだ欠陥だった。実装者の29 scenarioに網羅範囲の主張が0件で、gateが範囲を要求しないため範囲確認が作業から消えた"
related_stories:
  - story-vibepro-review-token-accounting-closure
  - story-vibepro-docs-only-evidence-profile
  - story-vibepro-evidence-adjudication-gate
reason: "alternatives considered: (a) Skillのdoc記述だけで class closure を周知する — 先行Storyで実際に記述したが、宣言は強制ではなく同じ失敗が再現しうる。(b) 全ての verify record に enumeration scenario を必須化する — docs-only変更や列挙対象を持たない変更で無意味な証跡を強制し、docs-only evidence profile と矛盾する。(c) 新規導入かつ複数 product source ファイルに跨る snake_case リテラルだけを対象に、専用 gate で fail closed にする — これを採用した。理由は、先行Storyで実際に取り逃した class (cost_missing の producer/consumer 分離) がまさにこの形状であり、単一ファイルに閉じたリテラルには列挙すべき class が存在しないため。compatibility impact: 既存の verify record の呼び出し形式・既存 scenario の意味・既存 gate の判定は変更しない。enumeration scenario は新しい任意の scenario 形式で、適用条件を満たす変更のみで必須になる。docs-only 変更は対象識別子が0件になるため not_applicable に落ち、docs-only evidence profile と競合しない。rollback plan: このブランチのコミットを revert すれば元の挙動に戻る。影響面は9つあり、revert 時にはすべてを戻す必要がある: (1) 新規モジュール src/enumeration-evidence.js、(2) src/pr-manager.js の gate ノード・DAGエッジ2本（failure_mode_coverage → enumeration_coverage → decision_record への張り替え）・requiredGates/nodes 登録・collectUnresolvedRequiredGates の type allowlist・isCriticalUnresolvedGate の1行、および共有 isUnresolvedGateStatus への 'inconclusive' 追加（これは全gateに効く共有リスト）、(3) src/execution-state.js の type allowlist・isCriticalUnresolvedGate・isUnresolvedStatus への 'inconclusive'、(4) src/evidence-depth-planner.js の RISK_BEARING_GATE_IDS 追加、(5) src/gate-outcome-ledger.js の UNRESOLVED_STATUSES への 'inconclusive'、(6) src/verification-evidence.js の record 時 parse 検証、(7) src/checkpoint-manager.js・src/html-report.js・src/canonical-audit.js・src/usage-report.js の未解決status語彙への 'inconclusive' 追加、(8) skills/vibepro-gate-evidence/SKILL.md の記述、(9) .vibepro/config.json のStory登録。既存の記録済み証跡artifactは形式が変わらないため影響を受けない。boundary and scope: 網羅範囲の宣言とその機械検証のみ。既存 gate の閾値・review 要件・evidence depth・budget は変更しない。列挙対象の自動修正や自動 grep 実行の代行はしない。"
parent_design: story-vibepro-enumeration-coverage-gate
created_at: 2026-07-26
updated_at: 2026-07-26
---

# 網羅範囲(enumeration)の証跡をGateで必須化し、instance単位の修正closureを止める

## Background

先行Story `story-vibepro-review-token-accounting-closure` の gate stage で独立レビューを
6ラウンド実施し、`.vibepro/reviews/story-vibepro-review-token-accounting-closure/gate/history/`
に14件の review result が記録された。findings は合計65件、severity 内訳は high 10 / medium 21 / low 34。
**high severity 10件のうち6件は、前ラウンドの修正自身が作り込んだ欠陥**だった。

原因は変更の難易度ではない。実装者の verification evidence は
`.vibepro/pr/story-vibepro-review-token-accounting-closure/verification-evidence.json` に
4 commands / 29 scenarios として記録されているが、
**網羅範囲を主張した scenario は 0件**（`enumerat|grepped|sites found|swept` のいずれにも一致せず、
`N sites` 形式の件数主張も0件）だった。
一方レビュアー側は `review-result-gate_evidence.json` の inspection summary に
毎回、読んだ範囲と再実行した件数（112/112、4/4 など）を明示していた。

差は能力ではなく**検証の完了条件**にある。gate が要求するのは振る舞いの証跡
（`schema_failure` / `negative_path` 等のトークンと `verified` artifact）だけで、
網羅範囲を要求しない。gate に無い項目は実装者の作業からも消えた。
結果として6ラウンド後の機械的列挙で、同一 class の未修正 instance が2件残っていた。

この学びは `skills/vibepro-gate-evidence/SKILL.md` の Class Closure 節に記載済みだが、
**それは宣言であって強制ではない**。今回実証されたのは「宣言では守れない」ことであり、
CLAUDE.md 0.6（再発防止は「気をつける」ではなく「止まる」仕組みで実装する）に従い、
gate 側で強制する。

## Measured baseline (2026-07-26)

`verify record` の証跡を消費する gate 面を列挙した結果:

- `src/pr-manager.js` の gate builder は 55件。うち `verificationEvidence` を引数に取るのは 11件。
- `observation.scenarios` を読む src モジュールは 7件（読み取り箇所は21件）。
- そのいずれも「網羅範囲」を要求する経路を持たない。gate は「何を動かしたか」を問うが
  「どこまで見たか」を問わない。

## Inherited behavior

When a change introduces no new cross-file enumerable identifier, the existing verification
evidence requirements are unchanged and existing.
When a scenario does not begin with the enumeration prefix, its existing classification and
token matching behaviour is unchanged and existing.
When a change is docs-only, the docs-only evidence profile and its depth resolution are
unchanged and existing.
The existing `verify record` command surface, its `--kind` overwrite semantics, and every
already recorded verification evidence artifact are unchanged and existing.
When `!supplied && !runAuthority` holds in `src/verification-evidence.js`, the existing run
authority resolution for a record supplied with neither an explicit value nor a resolved run
authority is unchanged and existing; this Story adds scenario validation only and does not
change how run authority is resolved.

## User Story

**As a** VibePro でレビュー指摘を修正する実装者およびそれを検収するレビュアー
**I want** 「どの識別子を、どの範囲で、何件見つけ、何件直し、何件を理由付きで残したか」を
証跡として宣言させ、その件数を gate 側が実際に再計測して検証してほしい
**So that** 指摘を instance 単位で閉じて class を開いたまま残す失敗が、
レビューの追加ラウンドではなく gate の停止として検出される

## Acceptance Criteria

- [ ] ENUM-S-1: enumeration scenario が厳密な契約形式でパースされ、識別子・探索範囲(paths)・
      発見件数N・更新件数M・意図的未更新件数Kとその理由が構造化される。
      件数を伴わない散文（"swept everything" 等）は受理されず、拒否理由が返る。
- [ ] ENUM-S-2: 件数の整合が機械検査される（N = M + K、かつ N >= 1、K > 0 なら理由が必須）。
      不整合な主張は fail closed で拒否される。
- [ ] ENUM-S-3: 主張された N が gate 側で実際に再計測される。宣言された paths 配下で
      識別子を whole-token 一致で数えた実測値が N と一致しない場合、および宣言 path が
      存在しない場合は fail closed。トークンを含む散文を書くだけでは通らない。
- [ ] ENUM-S-4: 適用条件が決定的に判定される。対象は「この変更で新規導入され、かつ HEAD 時点で
      product source 内で2つ以上のファイル **または** 2箇所以上に出現する snake_case / 名前空間付きリテラル」。
      1ファイル内に複数回登録される gate id のような登録クラスも対象に含む。
      該当が0件の変更（docs-only 変更を含む）では gate が `not_applicable` になる。
- [ ] ENUM-S-5: 対象識別子に検証済み enumeration scenario が無い場合、
      `gate:enumeration_coverage` が `needs_evidence` となって blocking gate に載り、
      `pr create` が止まる。scenario はあるが検証に失敗した場合は `failed` になる。

## Operational impact (measured 2026-07-27, streaming scanner)

`pr prepare` ごとに enumeration scope の走査が加算される。本リポジトリ実測（現 head）で
`collectEnumerationCoverage` 全体が約0.6秒、記録済み claim 1件の recount が
宣言レンジ（src, test, skills, docs配下3ディレクトリ）で約0.34秒。
参考として `docs` 全体（121MB）を宣言した場合は1 claim あたり約2.3秒。
キャッシュは持たないため、これを受容コストとして明示する。

走査は無制限ではなく、1行が400万文字を超えるファイルは unscannable として
報告する（minified bundle 等でメモリを使い切らないため）。product source 側で
読めないファイルが出た場合は class の大きさが確定できないため `inconclusive` になる。

## Non Goals

- 全ての変更・全ての `verify record` に enumeration scenario を必須化すること。
- 既存 gate の判定・閾値・review 要件・evidence depth・budget の変更。
- docs-only 変更に対する証跡要件の強化（対象0件で `not_applicable` に落ちる）。
- 列挙作業そのものの自動代行（gate は主張の検証をするが、修正はしない）。
