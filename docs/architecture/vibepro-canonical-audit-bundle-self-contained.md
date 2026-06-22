---
story_id: story-vibepro-canonical-audit-bundle-self-contained
title: Canonical Audit Bundle Self-contained Architecture
---

# Architecture

## Decision

canonical audit bundleを、`.vibepro` workspace cacheへの参照リストではなく、
handoff replayに必要な最小artifact集合として扱う。

`audit-bundle.json` は source path と canonical path の両方を持てるが、fresh checkoutでの
再構成は canonical path を正とする。bundle生成時にartifact本文内の `.vibepro/...` 参照も
検査し、canonical bundle配下に対応コピーがない参照は unresolved として記録する。

## Bundle Boundary

- include: PR lifecycle JSON、Gate DAG、traceability、verification evidence、review summary、
  review result、review lifecycle、manual verification artifactの要約またはmachine-readable result
- include when needed: subagent transcript summary、review request、durable command log summary
- exclude: HTML report、provider raw log、temporary dispatch scratch、巨大な途中状態

## Invariants

- fresh checkoutで `.vibepro` が空でも、merged Storyの判断経路を追える
- unresolved referenceを黙って成功扱いにしない
- raw logを保存しない方針とhandoff再現性を両立する
