# VibePro - 静的サイト診断

Vibe Coding で作成された静的サイトの公開前チェックを支援する

## 対象

- HTML/CSS/JS のみで構成された静的サイト
- サーバサイド・DB・ビルド不要の静的アセット配信

## 診断コマンドの使い方

### 1. 診断対象コードの配置

`target/` ディレクトリに診断対象の静的サイトを配置してください。

```bash
# 方法1: 既存プロジェクトをコピー
cp -r /path/to/your/site/* target/

# 方法2: git cloneで配置
git clone https://github.com/your/repo.git target/

# 方法3: シンボリックリンク（元のコードを直接参照）
ln -s /path/to/your/site target
```

### 2. 診断の実行

```txt
pre-analysis-runner agentを使って ./target ディレクトリを調べて
```

#### 静的サイトの場合

see [STATICSITE_FLOW.md](./STATICSITE_FLOW.md)

#### Next.js + supabase サイトの場合

WIP

#### その他の構成

WIP
