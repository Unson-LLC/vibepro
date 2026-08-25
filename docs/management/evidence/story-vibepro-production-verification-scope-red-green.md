# production verification scope Red / Green

- Base: `6790d84e5e1932a4be08ab978f3a12e91ee57230`
- Test: `node --test test/production-verification-scope.test.js`
- Red: base sourceへ同じtestを適用すると、`verification-evidence.js`に`normalizeEvidenceState` exportが存在せず、test file load時に失敗した。
- Green: 実装worktreeで3 tests pass、0 fail。

Redはbase treeを`git archive`で一時directoryへ展開して取得した。repo、branch、worktreeは変更していない。

## Independent review remediation

- Review base: `cd970700554145a88b12cbaa53b342063dff1e4d`
- Causal Red command: `node --test test/production-verification-scope.test.js`
- Red 1: 実CLIで同じ`kind=unit`の`local_test`と`production`を順に記録すると、後者だけが残り、2 commands期待に対して1 commandだった。
- Red 2: `verify run --scope staging`が拒否前にargvを実行し、エラー出力もscope validationではなかった。
- Green: 実CLI record、実`pr prepare`、副作用marker、legacy scope-less置換を含む6 testsで確認する。
