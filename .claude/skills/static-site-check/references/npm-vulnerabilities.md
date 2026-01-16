# npm パッケージ脆弱性対策

package.json で管理されている依存パッケージの脆弱性を検出・対応する方法。

## 検出方法

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

## 対応方法

### 1. 自動修正が可能な場合

**問題**: `npm audit fix` で修正可能な脆弱性

**対応**:
```bash
# 自動修正（semver互換の範囲で更新）
npm audit fix

# 強制修正（メジャーバージョン更新を含む）
npm audit fix --force
```

**注意**: `--force` は破壊的変更を含む可能性があるため、動作確認が必要

### 2. 自動修正が不可能な場合

**問題**: 依存関係の深い階層にある脆弱性

**対応**:

1. **overrides で強制バージョン指定**（npm 8.3+）
   ```json
   {
     "overrides": {
       "lodash": "4.17.21"
     }
   }
   ```

2. **パッケージの置き換え**
   - 脆弱なパッケージを別のパッケージに置き換え
   - 例: `moment` → `dayjs` / `date-fns`

3. **依存元パッケージの更新**
   - 脆弱なパッケージを使用している親パッケージを更新

### 3. 脆弱性が許容可能な場合

**問題**: 開発時のみ使用 / 影響範囲が限定的

**対応**:
- リスク評価を行い、許容可能であれば記録を残す
- `npm audit` の結果を定期的に確認

```bash
# 特定の脆弱性を無視（記録用）
# package.json に記載
{
  "auditConfig": {
    "ignore": ["GHSA-xxxx"]
  }
}
```

### 4. 未使用パッケージの削除

**問題**: 使用していないパッケージに脆弱性がある

**対応**:
```bash
# 未使用パッケージの検出
npx depcheck

# パッケージの削除
npm uninstall <package-name>
```

## 静的サイトでの注意点

静的サイトの場合、package.json があっても配信物には含めないため:

1. **devDependencies のみ使用している場合**
   - ビルドツール（webpack等）の脆弱性は本番環境に影響しにくい
   - ただし、ビルド成果物に影響する可能性は確認

2. **dependencies を使用している場合**
   - バンドルされて配信物に含まれる可能性がある
   - 高優先度で対応が必要

3. **配信物に package.json を含めない**
   - 本番配信時は静的ファイルのみにする
   - node_modules も配信対象から除外

## 予防策

- `npm audit` を CI/CD に組み込み
- Dependabot / Renovate で自動更新PR
- 定期的な依存関係の棚卸し
- 不要なパッケージは積極的に削除
