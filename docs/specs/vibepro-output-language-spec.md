---
story_id: story-vibepro-output-language
title: VibePro出力言語設定仕様
story_ref: docs/stories/vibepro-output-language-story.md
architecture_ref: docs/architecture/vibepro-output-language-architecture.md
---

# Spec: VibePro出力言語設定

## 設定

`.vibepro/config.json` に次を保存する。

```json
{
  "output": {
    "language": "ja"
  }
}
```

サポートする値:

- `ja`
- `en`

未設定または不正値は `ja` として扱う。ただしCLIで不正値を指定した場合はエラーにする。

## CLI

`init`:

```bash
vibepro init <repo> --language ja
vibepro init <repo> --language en
```

既存workspaceの変更:

```bash
vibepro config language <repo> --language ja
vibepro config language <repo> --language en
```

## PR準備成果物

`pr prepare` は解決済み言語を `pr-prepare.json` に記録する。

```json
{
  "output": {
    "language": "ja"
  }
}
```

次の人間向け成果物は固定ラベルを設定言語で表示する。

- `pr-prepare.html`
- `review-cockpit.html`
- `gate-dag.html`
- `split-plan.html`
- `pr-create.html`
- `pr-body.md`
- CLI summary

## 変更しないもの

次は言語設定で変更しない。

- JSON key
- schema version
- story id
- gate id
- status enum
- file path
- command
- Graphify node id

## 受け入れテスト

- `init --language en` は `.vibepro/config.json` に `output.language=en` を保存する
- `config language --language ja` は既存workspaceの `output.language` を `ja` に変更する
- `pr prepare` は `preparation.output.language` を持つ
- `ja` 設定ではPR HTMLの固定見出しが日本語になる
- `en` 設定ではPR HTMLの固定見出しが英語になる
