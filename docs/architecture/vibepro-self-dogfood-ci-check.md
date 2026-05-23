---
story_id: story-vibepro-self-dogfood-ci-check
title: Self-Dogfood CI Check Architecture
---

# Architecture

CIは既存のNode matrixの中で `node bin/vibepro.js check self-dogfood . --run-id ci-self-dogfood --json` を実行する。

`.vibepro/pr` はgit管理外のローカル証跡なので、fresh checkoutのCIではStoryごとのfinal Gate DAGを完全には検証できない。CIのself-dogfood checkは、docs / skills / agent-instructions / CI文言の退行や、tracked artifactに混入した明確なbypassを可視化する補助診断とする。

Storyごとのfinal Gate完了判定は、ローカル/PR作成前の `vibepro pr prepare` / `vibepro pr create` と、必要に応じた `vibepro check self-dogfood --story-id <story-id> --fail-on-findings` で強制する。
