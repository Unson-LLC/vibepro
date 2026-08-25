# production verification scope Red / Green

- Base: `6790d84e5e1932a4be08ab978f3a12e91ee57230`
- Test: `node --test test/production-verification-scope.test.js`
- Red: base sourceへ同じtestを適用すると、`verification-evidence.js`に`normalizeEvidenceState` exportが存在せず、test file load時に失敗した。
- Green: 実装worktreeで3 tests pass、0 fail。

Redはbase treeを`git archive`で一時directoryへ展開して取得した。repo、branch、worktreeは変更していない。
