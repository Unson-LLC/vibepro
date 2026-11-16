# Architecture: Accepted Specでtest.eachのケースを解決する

## Context

Accepted Specの`origin.test_refs[].case`は、target HEADのtest file blob内に同名のNode test caseがあるかを`nodeTestCaseExists`で検証する。現行実装は`test(caseName, ...)`と`it(caseName, ...)`だけを認識するため、`test.each(dataset)(caseName, ...)`と`it.each(dataset)(caseName, ...)`を誤って`test_case_missing`にする。

## Decision

- `nodeTestCaseExists`の完全一致規則を、通常呼び出しと`.each(dataset)(caseName, ...)`の二つの明示的な構文へ拡張する。
- `.each`のdataset部分は閉じ括弧を越えて探索しない。別の呼び出しにあるcaseNameを誤って結び付けない。
- caseNameは既存どおり正規表現用にescapeし、single quote、double quote、template literalの同一quote終端を要求する。
- 呼び出し元の`buildAcceptedSpecClauseMap`、Git blob取得、provenance、reason codeは変更しない。

## Impact

- 変更対象: `src/traceability.js`のNode test case存在判定。
- 検証対象: `test/accepted-spec-traceability.test.js`の通常test/it、test.each/it.each、template名不一致、および`scripts/validation/issue-462-zeims2-lineage.integration.test.mjs`による固定consumer HEADの7句とprovenanceの再検査。
- downstream: `buildAcceptedSpecClauseMap`、`buildClauseMapForPrepare`、`preparePullRequest`のAccepted Spec lineage判定。

## Compatibility and failure behavior

- 通常の`test`/`it`は従来の正規表現を維持する。
- `.each`でもcaseNameが完全一致しなければ`false`を返し、既存の`test_case_missing`でfail closedにする。
- target HEADのblob以外は読まず、HEAD SHAとblob OIDの来歴保証を維持する。

## Rollback

実装・回帰テスト・Story/Spec/Taskを含む単一commitをrevertする。Zeims2側のfixtureやAccepted Specに移行作業は発生しない。
