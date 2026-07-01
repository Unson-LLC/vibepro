# 共通スキャン結果

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-01T145445Z |
| index.html | なし |
| 走査ファイル | 1071件 |
| 秘密情報候補 | 37件 (block: 0件, review: 0件, info: 37件) |
| XSSリスク候補 | 14件 (block: 0件, review: 0件, info: 14件) |
| 外部リソース | 1件 |
| 非静的ファイル候補 | 60件 |

## 秘密情報候補

- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:15 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:1259 secret_keyword source_kind=test confidence=low gate_effect=info `apiKey: 'sk_l...cdef'``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:18 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:16267 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = process.env.SALESTAILOR_API_KEY;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:19 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17555 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = "sk-1...1234";``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:20 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17556 secret_keyword source_kind=test confidence=low gate_effect=info `const access_token = "runt...n123";``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:21 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17557 secret_keyword source_kind=test confidence=low gate_effect=info `const secret_key = plainsecretvalue;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:22 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17558 secret_keyword source_kind=test confidence=low gate_effect=info `const api_key = request.headers.get('x-api-key');``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:23 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17559 secret_keyword source_kind=test confidence=low gate_effect=info `const accessToken = body.access_token ?? null;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:24 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17561 secret_keyword source_kind=test confidence=low gate_effect=info `authToken: twilioAuthToken,``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:25 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17562 secret_keyword source_kind=test confidence=low gate_effect=info `apiKey: openaiConfig.apiKey!,``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:26 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17563 secret_keyword source_kind=test confidence=low gate_effect=info `access_token: accessToken``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:27 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17565 secret_keyword source_kind=test confidence=low gate_effect=info `FireCrawlApi(api_key=firecrawl_api_key);``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:28 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17572 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = process.env.EXAMPLE_API_KEY;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:29 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17576 secret_keyword source_kind=test confidence=low gate_effect=info `await writeFile(path.join(repo, 'docs', 'security.md'), 'Use API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in examples only.\n');``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:31 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17684 secret_keyword source_kind=test confidence=low gate_effect=info `const provider = new OpenAIProvider({ apiKey: openaiKey });``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:32 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17685 secret_keyword source_kind=test confidence=low gate_effect=info `access_token = get_token()``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:33 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17686 secret_keyword source_kind=test confidence=low gate_effect=info `const secret_key = plainsecretvalue;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:34 secret_keyword source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17844 secret_keyword source_kind=test confidence=low gate_effect=info `const api_secret = "runt...n123";``
- test/vibepro-cli.test.js:1259 secret_keyword source_kind=test confidence=low gate_effect=info `apiKey: 'sk_l...cdef'`
- test/vibepro-cli.test.js:2331 openai_key_like source_kind=test confidence=low gate_effect=info `console.log(JSON.stringify([{ RuleID: 'generic-api-key', File: 'src/config.js', StartLine: 2, Secret: 'sk-THI...AVED' }]));`
- test/vibepro-cli.test.js:2369 openai_key_like source_kind=test confidence=low gate_effect=info `assert.doesNotMatch(checkJson, /sk-THI...AVED/);`
- test/vibepro-cli.test.js:16378 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = process.env.SALESTAILOR_API_KEY;`
- test/vibepro-cli.test.js:17666 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = "sk-1...1234";`
- test/vibepro-cli.test.js:17667 secret_keyword source_kind=test confidence=low gate_effect=info `const access_token = "runt...n123";`
- test/vibepro-cli.test.js:17668 secret_keyword source_kind=test confidence=low gate_effect=info `const secret_key = plainsecretvalue;`
- test/vibepro-cli.test.js:17669 secret_keyword source_kind=test confidence=low gate_effect=info `const api_key = request.headers.get('x-api-key');`
- test/vibepro-cli.test.js:17670 secret_keyword source_kind=test confidence=low gate_effect=info `const accessToken = body.access_token ?? null;`
- test/vibepro-cli.test.js:17672 secret_keyword source_kind=test confidence=low gate_effect=info `authToken: twilioAuthToken,`
- test/vibepro-cli.test.js:17673 secret_keyword source_kind=test confidence=low gate_effect=info `apiKey: openaiConfig.apiKey!,`
- test/vibepro-cli.test.js:17674 secret_keyword source_kind=test confidence=low gate_effect=info `access_token: accessToken`
- test/vibepro-cli.test.js:17676 secret_keyword source_kind=test confidence=low gate_effect=info `FireCrawlApi(api_key=firecrawl_api_key);`
- test/vibepro-cli.test.js:17683 secret_keyword source_kind=test confidence=low gate_effect=info `const apiKey = process.env.EXAMPLE_API_KEY;`
- test/vibepro-cli.test.js:17687 secret_keyword source_kind=test confidence=low gate_effect=info `await writeFile(path.join(repo, 'docs', 'security.md'), 'Use API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in examples only.\n');`
- test/vibepro-cli.test.js:17786 openai_key_like source_kind=test confidence=low gate_effect=info `await writeFile(path.join(repo, '.env'), 'OPENAI_API_KEY=sk-1...1234\n');`
- test/vibepro-cli.test.js:17795 secret_keyword source_kind=test confidence=low gate_effect=info `const provider = new OpenAIProvider({ apiKey: openaiKey });`
- test/vibepro-cli.test.js:17796 secret_keyword source_kind=test confidence=low gate_effect=info `access_token = get_token()`
- test/vibepro-cli.test.js:17797 secret_keyword source_kind=test confidence=low gate_effect=info `const secret_key = plainsecretvalue;`
- test/vibepro-cli.test.js:17955 secret_keyword source_kind=test confidence=low gate_effect=info `const api_secret = "runt...n123";`

## XSSリスク候補

- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:38 eval_call source_kind=docs confidence=low gate_effect=info `- docs/static_site/check.md:25 eval_call source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:38 new_function source_kind=docs confidence=low gate_effect=info `- docs/static_site/check.md:25 eval_call source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:39 eval_call source_kind=docs confidence=low gate_effect=info `- docs/static_site/check.md:25 new_function source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:39 new_function source_kind=docs confidence=low gate_effect=info `- docs/static_site/check.md:25 new_function source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:40 inner_html_assignment source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17566 inner_html_assignment source_kind=test confidence=low gate_effect=info `document.body.innerHTML = location.hash;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:41 eval_call source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17567 eval_call source_kind=test confidence=low gate_effect=info `eval("1+1");``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:42 inner_html_assignment source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:17573 inner_html_assignment source_kind=test confidence=low gate_effect=info `element.innerHTML = userInput;``
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/references/vibepro/diagnostics/2026-06-30T061011Z/static-site-check-result.md:43 inner_html_assignment source_kind=docs confidence=low gate_effect=info `- test/vibepro-cli.test.js:18327 inner_html_assignment source_kind=test confidence=low gate_effect=info `await writeFile(path.join(repo, 'app.js'), 'document.bo`
- docs/static_site/check.md:25 eval_call source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない`
- docs/static_site/check.md:25 new_function source_kind=docs confidence=low gate_effect=info `- [ ] `eval()` / `new Function()` を使っていない`
- test/vibepro-cli.test.js:17677 inner_html_assignment source_kind=test confidence=low gate_effect=info `document.body.innerHTML = location.hash;`
- test/vibepro-cli.test.js:17678 eval_call source_kind=test confidence=low gate_effect=info `eval("1+1");`
- test/vibepro-cli.test.js:17684 inner_html_assignment source_kind=test confidence=low gate_effect=info `element.innerHTML = userInput;`
- test/vibepro-cli.test.js:18438 inner_html_assignment source_kind=test confidence=low gate_effect=info `await writeFile(path.join(repo, 'app.js'), 'document.body.innerHTML = location.hash;\n');`

## 外部リソース

- test/vibepro-cli.test.js:17642 script https://cdn.example.com/app.js

## 非静的ファイル候補

- .codex/config.toml (.toml)
- .git ((none))
- .github/ISSUE_TEMPLATE/bug_report.yml (.yml)
- .github/ISSUE_TEMPLATE/false_positive.yml (.yml)
- .github/ISSUE_TEMPLATE/feature_request.yml (.yml)
- .github/dependabot.yml (.yml)
- .github/workflows/ci.yml (.yml)
- .github/workflows/codeql.yml (.yml)
- .github/workflows/npm-publish.yml (.yml)
- .gitleaks.toml (.toml)
- LICENSE ((none))
- NOTICE ((none))
- REUSE.toml (.toml)
- docs/management/audit-artifacts/story-vibepro-ai-artifact-lineage-reconcile/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-architecture-readiness-gate/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-artifact-value-ledger/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-audit-bundle-budget/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-audit-replay-budget/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-audit-replay-command-surface/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-audit-scope-pruning/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-automation-readable-value-audit/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-automation-runtime-cost-ingestion/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-budget-policy-semantics/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-canonical-audit-bundle-self-contained/references/vibepro/manual-verification/story-vibepro-canonical-audit-bundle-self-contained/focused.tap (.tap)
- docs/management/audit-artifacts/story-vibepro-canonical-audit-cost-accounting/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-code-topology-judgment-evidence/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-codebase-memory-skill/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-compressed-audit-replay-package/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-concise-pr-body/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-design-modernize-journey-context/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-design-ssot-coverage-auditor/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-design-ssot-reconciliation/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-execute-merge-cost-accounting/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-layer-aware-e2e-gate/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-manual-pr-flow-alignment/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-meeting-minutes-editor-prompt/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-pr-body-path-links/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-pre-spec-readiness-gate/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-reporting-gate-precision/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-residual-risk-closure/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-responsibility-authority-core-catalog/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-responsibility-authority-registry/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-runtime-cost-gap-closure/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-senior-gap-judgment/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-session-cost-attribution-hardening/audit-replay-bundle.json.gz (.gz)
- docs/management/audit-artifacts/story-vibepro-traceability-ac-to-code-map/references/vibepro/manual-verification/story-vibepro-traceability-ac-to-code-map/focused.tap (.tap)
- docs/management/audit-artifacts/story-vibepro-traceability-ac-to-code-map/references/vibepro/manual-verification/story-vibepro-traceability-ac-to-code-map/typecheck.log (.log)
- docs/public/_headers ((none))
- docs/public/_redirects ((none))
- test/e2e/story-vibepro-engineering-judgment-activation-precision-main.spec.ts (.ts)
- test/e2e/story-vibepro-evidence-user-fingerprint-main.spec.ts (.ts)
- test/e2e/story-vibepro-execute-merge-command-flow.spec.ts (.ts)
- test/e2e/story-vibepro-execution-judgment-status-integrity-main.spec.ts (.ts)
- test/e2e/story-vibepro-managed-worktree-execution-dag-main.spec.ts (.ts)
- test/e2e/story-vibepro-managed-worktree-gate-main.spec.ts (.ts)
- test/e2e/story-vibepro-pr-body-path-links-main.spec.ts (.ts)
- test/e2e/story-vibepro-pr-ship-command-main.spec.ts (.ts)
- test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts (.ts)
- test/e2e/story-vibepro-review-status-required-only-main.spec.ts (.ts)
- test/e2e/story-vibepro-usage-report-main.spec.ts (.ts)
