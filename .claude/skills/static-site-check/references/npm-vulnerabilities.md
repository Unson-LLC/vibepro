# npm パッケージ脆弱性チェック

package.json で管理されている依存パッケージの脆弱性を検出する方法。

## チェック方法

### npm audit の実行

```bash
# 脆弱性チェック
npm audit

# JSON形式で出力（パース用）
npm audit --json

# 本番依存のみチェック
npm audit --omit=dev
```

### 出力例

```
# npm audit report

lodash  <4.17.21
Severity: high
Prototype Pollution - https://github.com/advisories/GHSA-xxxx
fix available via `npm audit fix`

2 vulnerabilities (1 moderate, 1 high)
```

## 脆弱性レベル

| レベル | 説明 | 対応優先度 |
|--------|------|------------|
| critical | 即時悪用可能、重大な影響 | 最優先 |
| high | 悪用可能、大きな影響 | 高 |
| moderate | 条件付きで悪用可能 | 中 |
| low | 悪用困難、影響限定的 | 低 |

## 報告内容

脆弱性が検出された場合、以下を報告:

1. **検出された脆弱性の一覧**
   - パッケージ名とバージョン
   - 脆弱性のレベル（critical/high/moderate/low）
   - 脆弱性の種類（Prototype Pollution, XSS 等）

2. **依存関係の種類**
   - dependencies（本番で使用）→ 優先度高
   - devDependencies（開発時のみ）→ 優先度低

3. **配信物への影響**
   - バンドルに含まれるか
   - 静的ファイルとして配信されるか

## 未使用パッケージの扱い

`depcheck` などで未使用と判定されたパッケージに脆弱性がある場合:

- **結果の件数には含めない**（実際には使用されていないため）
- **参考情報として別途報告する**（削除を推奨）

```bash
# 未使用パッケージの検出
npx depcheck
```

## 静的サイトでの注意点

1. **devDependencies のみ使用している場合**
   - ビルドツールの脆弱性は本番環境に影響しにくい
   - ただし、ビルド成果物に影響する可能性は確認

2. **dependencies を使用している場合**
   - バンドルされて配信物に含まれる可能性がある
   - 高優先度で報告

3. **配信物に含めてはいけないもの**
   - `package.json`
   - `package-lock.json`
   - `node_modules/`

## チェック結果の記載例

```markdown
## npm パッケージ脆弱性

### 検出結果（使用中のパッケージのみ）
- 脆弱性総数: 3件
- critical: 1件
- high: 1件
- moderate: 1件

### 詳細

| パッケージ | バージョン | レベル | 種類 | 依存元 |
|-----------|-----------|--------|------|--------|
| lodash | 4.17.15 | high | Prototype Pollution | 直接依存 |
| minimist | 1.2.0 | critical | Prototype Pollution | webpack > ... |

### 配信物への影響
- lodash: バンドルに含まれる → 要対応
- minimist: devDependencies のみ → 影響低

---

### 参考: 未使用パッケージの脆弱性（件数には含めず）

以下は未使用のため結果には含めていないが、削除を推奨:

| パッケージ | バージョン | レベル | 備考 |
|-----------|-----------|--------|------|
| moment | 2.29.1 | moderate | 未使用 → 削除推奨 |
| request | 2.88.0 | high | 未使用 → 削除推奨 |
```
