# VibePro PR-body narrative authoring (for the calling AI)

You are receiving a JSON payload from `vibepro report fingerprint --kind pr-body`.
Emit a JSON narrative back into `vibepro report write --kind pr-body --from-stdin`.

You do NOT write the whole PR body. VibePro keeps the skeleton (headings, file
lists, gate-dag, verification commands). You write the **prose that requires
judgment** — synthesis a template cannot do.

## Four slots

1. **`summary`** — 1 slot. 2–5 sentences. "What does this PR change and why
   does it matter?" Lead with the user-visible effect, not the file count.
2. **`review_focus`** — 1–5 slots, one bullet each. The 1–3 things a reviewer
   should examine that are not obvious from the diff. Avoid generic advice
   ("check tests"). Be specific: which file's invariant is brittle, which clause
   is contested, which drift item is load-bearing.
3. **`risks_synthesis`** — 1 slot, 1–3 sentences. Synthesize across the
   mechanical risk list. "What is the dominant failure mode this PR
   introduces?" If there is no real risk beyond the enumeration, output:
   `text: "特記事項なし"`.
4. **`open_questions`** — 0–5 slots, one item each. Things you could not
   determine from Story+Code+Test+drift. Reviewer must adjudicate. Skip
   entirely if nothing is open.

## Rules

1. **Cite, do not paraphrase silently.** If you mention a file, list it in
   `citations.files`. If you reference a finding (`VP-TASK-001`), drift item
   (`DRIFT-ABC123`), or clause (`INV-001`), list it in the matching
   citations array. Validator rejects citations to objects that do not exist.
2. **Numerical claims must use `numerical_claims[]`.** If you write
   "drift items が 3 件", you must also declare
   `{"field":"drift_total_count","value":3}`. Validator compares to fingerprint.
3. **Reuse TP ids when possible.** If `previous_narrative` contains a slot
   whose text is semantically equivalent, copy its id. Otherwise use
   `TP-NEW-<n>` — validator assigns stable ids.
4. **No markdown headings.** Plain text per slot item. Bullets render as `- `
   automatically.
5. **No filler.** "This PR makes changes" / "Tests should pass" / "Please
   review carefully" — delete. Each slot must give the reviewer something
   they couldn't see by reading the diff.

## Output format

```jsonc
{
  "schema_version": "0.1.0",
  "story_id": "<copy from fingerprint.story_id>",
  "kind": "pr-body",
  "generated_by": { "caller": "claude-code", "stage": "ai_synthesis" },
  "narrative_slots": [
    {
      "id": "TP-NEW-1",
      "slot": "summary",
      "text": "premium ユーザーの cancelAtPeriodEnd 経路で userType=1 に降格していた回帰を src/lib/services/billing.ts で修正。INV-001 で宣言された不変条件と一致するように分岐を再整列した。",
      "citations": {
        "files": ["src/lib/services/billing.ts"],
        "clause_ids": ["INV-001"]
      },
      "numerical_claims": []
    },
    {
      "id": "TP-NEW-2",
      "slot": "review_focus",
      "text": "src/lib/services/billing.ts:142 の早期 return が、テスト対象外の status='premium_pending_cancel' 経路を引き起こす。テスト追加が無いまま invariant に依存しているので、reviewer は手で経路を辿るべき。",
      "citations": {
        "files": ["src/lib/services/billing.ts"]
      }
    },
    {
      "id": "TP-NEW-3",
      "slot": "risks_synthesis",
      "text": "drift items は spec_test 軸に偏っており、INV-001 を機械検証する test が無い。実装が変更されたら回帰検出が手作業になる。",
      "citations": {
        "clause_ids": ["INV-001"],
        "drift_ids": ["DRIFT-AB12CD"]
      },
      "numerical_claims": [
        { "field": "drift_high_count", "value": 1 }
      ]
    }
  ]
}
```

## What VibePro does with your output

- JSON schema validation.
- Per-slot: every `citations.files[]` must exist in repo. Every
  `finding_ids[]` must appear in `evidence.findings[]`. Every `clause_ids[]`
  must appear in inferred spec. Every `drift_ids[]` must appear in drift.json.
  Every `numerical_claims[]` must match fingerprint values.
- TP id stabilization via text similarity vs previous narrative.
- Writes `.vibepro/report/<story-id>/pr-body/narrative.json`.
- `vibepro pr prepare` splices your text into pr-body.md as 4 dedicated
  sections at the top, attributed to TP ids.

## Common mistakes

- **Generic summary.** "This PR addresses the story." Useless. Tell the
  reviewer the *causal mechanism* of the change.
- **Inventing IDs.** If you write `DRIFT-XYZ123` but it isn't in
  `fingerprint.drift.items[]`, you will be rejected. Always copy ids verbatim
  from the fingerprint.
- **Numerical drift.** Writing "5 drift items" when there are 3 → rejection.
- **Filling open_questions with noise.** If you have no real open question,
  return an empty array.
