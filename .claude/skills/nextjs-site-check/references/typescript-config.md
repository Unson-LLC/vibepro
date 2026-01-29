# TypeScript 設定チェック

TypeScript の型安全性設定を確認・報告する。

## 深刻度: Medium

## 出力先: `results/nextjs-check-typescript.md`

TypeScript の strict 設定は、実行時エラーやセキュリティ問題の早期発見に重要。

## 検出パターン

```
# tsconfig.json の strict 設定
"strict":\s*false
"strict":\s*true

# 個別の strict オプション
"noImplicitAny":\s*false
"strictNullChecks":\s*false
"strictFunctionTypes":\s*false
```

## リスク

- **型安全性の低下**: 実行時エラーの増加
- **null/undefined エラー**: 予期しないクラッシュ
- **暗黙的な any**: 型チェックのバイパス
- **メンテナンス性低下**: リファクタリング時のバグ混入

## チェック項目

### 1. strict モード

**検出対象**:
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true  // または false / 未設定
  }
}
```

**判定基準**:
- `"strict": true` → OK
- `"strict": false` または未設定 → 警告

**報告内容**:
- strict の設定値
- 推奨事項（段階的導入の可否を含む）

### 2. 個別の strict オプション

`strict: true` は以下を有効化:
- `noImplicitAny`
- `strictNullChecks`
- `strictFunctionTypes`
- `strictBindCallApply`
- `strictPropertyInitialization`
- `noImplicitThis`
- `alwaysStrict`

**検出対象**:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": false  // strict を部分的に無効化
  }
}
```

**報告内容**:
- 無効化されているオプション
- 影響と推奨事項

### 3. セキュリティ関連の設定

**確認項目**:
```json
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,  // 配列アクセスの安全性
    "exactOptionalPropertyTypes": true,  // オプショナルプロパティの厳密化
    "noPropertyAccessFromIndexSignature": true  // インデックスアクセスの明示化
  }
}
```

**報告内容**:
- 追加の型安全性オプションの設定状況
- 推奨事項（必須ではないが推奨）
- 既存コードへの影響（型エラー増加の可能性）

### 4. Next.js 推奨設定

**確認項目**:
```json
{
  "compilerOptions": {
    "target": "ES2017",  // または新しいバージョン
    "lib": ["dom", "dom.iterable", "esnext"],
    "moduleResolution": "bundler",  // Next.js 13.4+
    "module": "esnext",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

**報告内容**:
- Next.js 推奨設定との差異
- 潜在的な問題
- `moduleResolution: "bundler"` 変更時の影響（ツール/パス解決の互換性）
- `jsx` / `types` / `typeRoots` の誤設定がないか

### 5. 型定義の確認

**確認項目**:
- `@types/node`, `@types/react` 等の型定義パッケージ
- カスタム型定義ファイル（`*.d.ts`）

**報告内容**:
- 不足している型定義
- 古いバージョンの型定義
- ESM パッケージの型解決問題や `types` 重複がないか

## 推奨される tsconfig.json

```json
{
  "compilerOptions": {
    // 基本設定
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,

    // 型安全性（重要）
    "strict": true,
    "noUncheckedIndexedAccess": true,

    // モジュール解決
    "moduleResolution": "bundler",
    "module": "esnext",
    "resolveJsonModule": true,
    "isolatedModules": true,

    // Next.js
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],

    // 出力
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## チェック結果の記載例

```markdown
## TypeScript 設定

### 検出結果
- strict モード: NG（false）
- 個別オプション: 2件の問題
- Next.js 推奨設定: 一部不足

### strict モード

| 設定 | 現在値 | 推奨値 | 判定 |
|------|--------|--------|------|
| strict | false | true | NG |

### 個別オプション

| オプション | 現在値 | 影響 |
|------------|--------|------|
| noImplicitAny | false | 型チェックが緩くなる |
| strictNullChecks | false | null/undefined エラーを見逃す |

### 追加の型安全性オプション（推奨）

| オプション | 現在値 | 推奨 |
|------------|--------|------|
| noUncheckedIndexedAccess | 未設定 | true |
| exactOptionalPropertyTypes | 未設定 | true |

### Next.js 設定

| 設定 | 現在値 | 推奨値 | 判定 |
|------|--------|--------|------|
| moduleResolution | node | bundler | 要更新 |
| plugins | 未設定 | [{"name":"next"}] | 推奨 |

### 推奨対応

1. `"strict": true` を設定
2. `moduleResolution` を `bundler` に変更
3. Next.js プラグインを追加
4. `noUncheckedIndexedAccess: true` を追加（推奨）
```

## 段階的な strict 化

既存プロジェクトで一度に `strict: true` にできない場合:

```json
{
  "compilerOptions": {
    "strict": false,
    // 段階的に有効化
    "noImplicitAny": true,  // Step 1
    "strictNullChecks": true,  // Step 2
    "strictFunctionTypes": true,  // Step 3
    // ...最終的に strict: true へ
  }
}
```

**補足**:
- `skipLibCheck: true` は型安全性の妥協点。可能なら段階的に解除
- まず `noImplicitAny` を有効化し、次に `strictNullChecks` を導入すると現場で進めやすい
