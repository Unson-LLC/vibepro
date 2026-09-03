# 複数remote環境のPR送信先整合性 Spec

## CLI

`vibepro pr create` に次を追加する。

- `--push-remote <name>`: push対象のGit remote。
- `--repo <owner/name>`: `gh pr` の対象GitHub repository。

異なるrepositoryを指すremoteが複数ある場合、どちらかの指定からpush remoteとPR repositoryを一意に解決できなければ停止する。

## Validation

GitHub repositoryはHTTPS URL、`ssh://git@github.com/...`、`git@github.com:...`から正規化する。選択したpush remoteのrepositoryとPR repositoryは一致必須とする。baseが`remote/branch`形式なら、そのremoteのrepositoryを`base_repository`として記録する。

実行計画作成時、push直前、PR作成直前にremote URLを読み直す。URLまたは正規化repositoryが計画と異なれば、次の外部変更を実行しない。

## Output

dry-run出力と`pr-create.json`は送信先、base/head ref、HEAD SHA、および段階別validation結果を保持する。`gh pr create/list/edit`には必ず`--repo`を渡す。
