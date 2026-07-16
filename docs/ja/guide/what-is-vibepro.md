# VibeProとは

VibeProは、**AIエージェント開発を、証拠付きで安全に出荷するためのリポジトリローカル制御基盤**です。プロダクトをチームの代わりに作るのではなく、プロダクト意図からmergeまでの経路を可視化し、証拠や判断が欠ける箇所をfail-closedで止めます。

現在の制御ループは次の通りです。

1. Storyで成果と受け入れ条件を固定する
2. Architecture / Specで境界、契約、テスト、rollbackを定義する
3. bounded branchまたはmanaged worktreeで実装する
4. 現在のcommitに対する観測結果を検証証跡として記録する
5. 独立したAgent Reviewが差分と証跡を検査する
6. AdjudicationがSpec clauseとSenior Judgmentの成立を裁定する
7. Release Guardと `pr prepare` がrisk-adaptive Gate DAGを解決する
8. `pr create` が現在の証跡からPRを作成・更新する
9. CIをimportし、現在head向けにPR artifactを再生成する
10. `execute merge` が監査された経路でmergeする
11. Canonical auditとusage / ROI reportが、何をなぜ出荷し、証跡にどれだけコストを使ったかを残す

## 人間が握るもの

人間が入口と出口を握ります。プロダクト意図、重大なtrade-off、最終release authorityは人間の責任です。Agentは実装・検査・提案を行い、証跡は成立を示しますが、どちらもauthorityを暗黙に広げません。

## VibeProがしないこと

- hosted coding agent、issue tracker、product knowledge baseではない
- test、CI、security review、deploy observability、engineering judgmentを置き換えない
- 生成された説明、graph、screenshot、PR本文だけを証拠として扱わない
- すべての変更を同じ重さにせず、検出したリスクに応じてGateを広げる

Brainbaseは、product context、組織知、Story候補を供給する任意のupstreamです。VibeProはdownstreamの実行・PR Gateを所有し、Brainbaseなしでも使えます。

次は[制御ループ](/ja/guide/control-loop)へ進むか、[トップ](/ja/)から役割別の経路を選んでください。
