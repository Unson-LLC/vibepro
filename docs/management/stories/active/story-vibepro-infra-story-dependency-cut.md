---
story_id: story-vibepro-infra-story-dependency-cut
title: workspace-infraからstoryへの許可外依存を削減する
status: active
reason: alternatives（1: allowed_dependenciesにinfra->storyを追加して違反を消す案は、target-model.jsonが裁定済みの「infraは何にも依存しない」規範を無効化するメトリクスのゲーミングであり却下。2: managed-worktree.js/merge-manager.js全体をstoryモジュールへ再配属する案は、責務がworktree/gitライフサイクル管理でありinfra側が正しいため却下。3: 採用案は、story-manager.js等への直接呼び出し箇所をコールバック注入(dependency injection)またはinfra側への処理移動に置き換える）。compatibility（呼び出し元のcli.js/pr-manager.js等がinfra関数に渡す引数を追加するだけで、公開関数シグネチャの後方互換は維持する。既存呼び出しは全て更新するため壊れた呼び出しは残らない）。rollback（target-model.jsonのallowed_dependenciesもコードも変更前に戻せば元の依存関係に戻る。violationが増えた場合はconformance dry-runなので既存gateはblockされない）。boundary（変更範囲はsrc/managed-worktree.js, src/merge-manager.js, src/codex-manager.js等workspace-infra配下ファイルとそれらの呼び出し元cli.js/pr-manager.js等に限定し、story/task/gate-pr側の公開APIの意味は変更しない）。
---

# workspace-infraからstoryへの許可外依存を削減する

## User Value

VibePro開発者が、target-model.json(裁定済みto-beモデル)の「workspace-infraは何にも依存しない」という規範に対する最大の違反ペア(`workspace-infra -> story`)を削減できる。これによりconformance dry-runのviolation総数が実測で下がり、精錬(削る)ループが初めて機能した証拠が得られる。infra層がstory層のSSOT実装詳細(story-manager.js等)を直接呼ばなくなることで、依存の方向がtarget modelの宣言どおり単方向(cli -> * / story -> infra)に揃う。

## Acceptance Criteria

- `IDC-AC-001`: `vibepro architecture conformance . --json` の `workspace-infra -> story` エッジ数が、着手前の実測値(46。origin/mainの親コミットで再実行しても安定して46)から減少している(独立した複数回の再測定で安定して45)。コードで検証可能な実依存3件(managed-worktree.js/managed-worktree-gate.jsのdecision-records.js直接呼び出し2件、guard.jsのstory-manager.js直接呼び出し1件)は、変更後のimport文を直読して構造的に除去されたことを確認する。測定上のネット差分(-1)が除去した実依存数(3件)と一致しない差分(+2)は、`src/workspace.js -> src/story-manager.js` の宣言外呼び出しとしてgraphifyがカウントするノイズエッジ数が、変更前後のコミット間で偶然21→23に増えたことによる相殺であり、workspace.jsが変更前後どちらのコミットでもstory-manager.jsを実インポートしていないことをソースコード直読で確認する(件数の完全一致ではなく、実依存3件の構造的除去と、ノイズによる相殺の内訳説明が受け入れ条件)。
- `IDC-AC-002`: conformance の violation総数(distinct module-pair violation数)が、着手前の実測値(85。手書きmemoryの68は2日前時点の実測でありその後の新規ファイル追加により陳腐化していた)から増加していない。
- `IDC-AC-003`: `workspace-infra -> story` 以外のモジュールペアで新規のviolationが発生していない(既存ペアのedge_countの増減は許容するが、0件だったペアへの新規出現は不可)。
- `IDC-AC-004`: target-model.jsonの`allowed_dependencies`は変更しない(infra->storyの許可追加や既存規範の緩和を行わない)。モジュールの`paths`再配属(decision-records.jsをstory→workspace-infraへ)は、その責務(実インポート/被参照先が100%workspace-infra/gate-pr/cliのみで、story catalog機能を一切持たない)の実証をもって許容する。
- `IDC-AC-005`: 変更対象ファイル(workspace-infra配下および呼び出し元)の既存テストが全てpassする。
- `IDC-AC-006`: 変更によるnet LOCが負またはほぼ中立である(依存逆転はロジック移動・削除であり、大規模な新規コード追加を伴わない)。

## Non Goals

- `workspace-infra -> story`以外の違反ペア(例: 他モジュール間の許可外依存)の解消は本Storyの範囲外。
- target-model.jsonのモジュール定義・複雑性予算の改訂は行わない。
- senior-gap judgmentのbuildIdealState配線は別Storyで扱う。
- graphify(外部CLIツール)の`calls`エッジ抽出ロジックの修正は本Storyの範囲外。ソースコード直読で検証した結果、`workspace-infra -> story`エッジの大半(例: `src/workspace.js -> src/story-manager.js`)はworkspace.js側に実インポートが一切存在しない誤検出であり、外部graphifyツールの呼び出し元/先の attribution 不具合(同一ファイル内の呼び出し連鎖を、識別子の定義元ファイルを主語にして逆向きに記録する挙動)に起因すると判断した。独立した複数回の再測定では、変更前コミット(46件)・変更後コミット(45件)ともに安定しており、同一コミット内でのrun-to-run非決定性は確認されなかった(先行の「46→45→45」という記述は、単一の初回測定と複数回の事後測定を比較しただけで、同一コードでの再実行比較ではなかったための誤記であり、本Storyで訂正する)。ズレの実体は、`src/workspace.js -> src/story-manager.js` のノイズエッジ数が変更前後のコミット間で21件→23件に変化したことによる相殺であり、この不具合の修正は本repoの外(graphify本体)であり別途フラグする。
