---
story_id: story-brainbase-runtime-context-handoff
status: accepted
created_at: 2026-08-31
updated_at: 2026-08-31
---

# Brainbase runtime context handoff architecture

## 境界

```text
Brainbase Host
  ├─ initial Judgment receipt（model生成前・再分類不可）
  ├─ knowledge.resolve routing receipt
  └─ actual retrieval references + content digests
          │
          ▼
vibepro integration brainbase bind
  └─ .vibepro/integrations/brainbase/<story>/context.json
          │  authority = brainbase / snapshot_not_authority = true
          ▼
implementation + affected verification
          │
          ▼
vibepro integration brainbase event
  └─ knowledge_event.v1（local artifact only）
          │
          ▼
Brainbase MCP brainbase_knowledge_event_record
  └─ /api/knowledge/events → Candidate
```

## 決定

1. **Judgmentは入力であり、VibeProの機能ではない。** VibeProはHost receiptをdigest検証して束縛するだけで、Resolverを呼ばない。
2. **knowledge.resolveとretrievalを分離する。** routing receiptだけではKnowledge利用と見なさず、source class・retrieval capability・canonical URI・content digestを持つ参照を要求する。
3. **repositoryへ本文を複製しない。** local contextには参照とdigestだけを保存する。v1ではPersonal Knowledgeとoperational stateを対象外にする。
4. **学習は検証後だけ生成する。** contextの`bound_at`以後に実行され、current git fingerprintと一致するcomputed passing evidenceを必須にする。
5. **VibeProはネットワーク書き込みをしない。** event recordingはBrainbase MCP toolへ委譲し、global HostのPostToolUse監査を通す。
6. **学習は候補で止める。** subjectは`development_learning`、authority・Graph promotion・external actionはfalseとし、自動Decision化しない。

## セキュリティ

- absolute local path、`file://`、本文、token/password/emailをeventへ載せない。
- handoff digest、receipt digest、reference content digest、context digest、verification artifact digest、body hashを別々に保持する。
- event IDはsource・subject・parent episode・body hashから決定的に生成する。
- stale/self-reported/pre-context verificationはfail closedする。

## Rollback

新module・CLI route・docs・testsをrevertする。既存`vibepro brainbase`、Story/Spec/verification/review/PR機能、永続DBには変更がない。
