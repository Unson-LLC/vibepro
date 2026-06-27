# Check Packs

Check Packs group repeatable verification checks for a repository or workflow.

```bash
vibepro check pr-readiness . --story-id <story-id> --base main
vibepro check regression-risk .
```

Use Check Packs to make evidence collection repeatable. Do not use a passing check as a substitute for missing runtime, security, data, or release evidence when those axes are active.
