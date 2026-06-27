# Check Packs

Check Packsは、リポジトリやworkflowごとの反復可能な確認をまとめます。

```bash
vibepro check pr-readiness . --story-id <story-id> --base main
vibepro check regression-risk .
```

証跡収集を再現可能にするために使います。該当軸がactiveな場合、checkが通っただけでruntime、security、data、release証跡の不足を置き換えてはいけません。
