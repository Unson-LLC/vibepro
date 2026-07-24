# 構造プロファイル

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-24T160303Z |
| 種別 | unknown |
| 描画方式 | - |
| パッケージ管理 | npm |
| 言語 | javascript, typescript |
| API route | なし |
| DB | なし |
| 認証 | なし |
| 配信 | - |

## View

| View | 判定 |
|------|------|
| Structure | - |
| Runtime | 0 entrypoints, server_actions |
| Data | - |
| Security | 0 auth boundaries, 0 secret files |
| Deployment | - |
| Quality | .github/workflows/ci.yml, .github/workflows/codeql.yml, .github/workflows/npm-publish.yml, .github/workflows/post-merge-release.yml |

## 適用チェック

- secrets
- xss
- dependency-graph
- code-quality
- api-boundary

## 根拠

- package_json: package.json vibepro
