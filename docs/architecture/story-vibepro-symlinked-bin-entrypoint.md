# Architecture: symlinked binary entrypoint

## Context

Node.jsのES module loaderはfile symlinkから読み込んだmoduleの `import.meta.url` を実体パスへ正規化する。一方、`process.argv[1]` は利用者が実行したsymlink表記を保持する。文字列化したURL同士の比較では両者が一致せず、npm/global binの標準的なsymlink配置で `main()` が呼ばれない。現状は終了コード0のまま出力がないため、明示的な失敗より検知しにくい。

## Decision

直接実行判定を小さな同期helperへ分離し、module URLとargv entrypointの双方をfilesystemの実体パスへ解決して比較する。symlinkでない直接実行も同じ比較を通す。`realpathSync` が失敗する入力はfalseを返し、module import時に起動しない既存境界を守る。

## Invariants

- 直接実行または同一fileを指すsymlinkだけが `main()` を起動する。
- import利用は副作用としてCLIを起動しない。
- entrypoint判定は環境変数、subcommand、artifactへ触れない。
- 解決不能な入力でmodule importを失敗させない。

## Failure and rollback

実体パス解決は起動時に一度だけ行う。問題時はhelperを除去し、従来のURL文字列比較へ戻せる。global wrapperや利用者ホーム側の例外処理は正本にしない。
