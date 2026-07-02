# API設計

## 1. 基本方針

- REST / GraphQL / RPC：
- 認証方式：
- レスポンス形式：
- エラー形式：
- ページネーション方式：

## 2. エンドポイント命名規則

| 種別 | 例 | 方針 |
|---|---|---|
| 一覧取得 | GET /api/admin/resources |  |
| 詳細取得 | GET /api/admin/resources/:id |  |
| 作成 | POST /api/admin/resources |  |
| 更新 | PATCH /api/admin/resources/:id |  |
| 削除 | DELETE /api/admin/resources/:id |  |

## 3. 共通レスポンス形式

### Success

```json
{
  "data": {},
  "meta": {}
}
```

### Error

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "ユーザー向けメッセージ"
  }
}
```

## 4. 一覧取得・ページネーション方針

ページネーションは、すべてのAPIで必須ではない。
一覧取得APIや、返却件数が多くなる可能性のあるAPIで必要に応じて使用する。

### 使用するケース

- 一覧取得API
- 検索API
- 履歴取得API
- ログ取得API
- 件数が増え続けるデータを返すAPI

### 使用しないケース

- 詳細取得API
- 単一リソース取得API
- 件数が固定または少数であるAPI

### 採用する方式

このプロジェクトでは、以下の方式を採用する。

- [ ] page / limit 型
- [ ] cursor 型
- [ ] その他：__________

### Request Query

| name | type | required | default | description |
|---|---|---:|---|---|
| page | number | no |  | ページ番号 |
| limit | number | no |  | 1ページあたりの取得件数 |
| cursor | string | no |  | 次ページ取得用カーソル |

### Response

```json
{
  "data": [],
  "meta": {
    "pagination": {
      "page": null,
      "limit": null,
      "total": null,
      "nextCursor": null,
      "hasNext": null
    }
  }
}
```

## 5. バリデーション方針

-
-
-

## 6. 認証・権限

詳細は [認証・権限設計](./04_auth_permission.md) を参照。

## 7. エラー

詳細は [エラー設計](./05_error_design.md) を参照。

## 8. 関連資料

- [認証・権限設計](./04_auth_permission.md)
- [エラー設計](./05_error_design.md)
- [非機能要件](./07_non_functional_requirements.md)
- [各機能の技術差分](../features/)
