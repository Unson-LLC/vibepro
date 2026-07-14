import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const implementation = readFileSync(new URL('../../src/pr-manager.js', import.meta.url), 'utf8');
const cliRegression = readFileSync(new URL('../vibepro-cli.test.js', import.meta.url), 'utf8');

test('story-vibepro-pr-body-published-evidence-integrity acceptance coverage', () => {
  // current-head passing evidence is projected even without an auto-detected command.
  assert.match(implementation, /collectCurrentPassingVerificationEvidence\(verificationEvidence\)/);
  assert.match(implementation, /currentPassingEvidenceItems/);
  assert.match(cliRegression, /Current HEAD external verification passed/);
  assert.match(cliRegression, /docs\/stale-evidence-change\.md/);

  // Local VibePro workbench paths are never published as GitHub links.
  assert.match(implementation, /function isLocalVibeProArtifactPath/);
  assert.match(implementation, /function formatPrBodyPathReference/);
  assert.match(implementation, /formatPrBodyPathReference\(`\.vibepro\/pr\/\$\{storyId\}\/pr-body\.md`\)/);
  assert.match(cliRegression, /doesNotMatch\(waivedPrBody/);

  // Post-render waiver text and body-limit fallbacks use the same publication policy.
  assert.match(implementation, /reason: \$\{linkifyRepoPathsInText\(gateOverride\.reason\)\}/);
  assert.match(implementation, /buildMinimalGithubPrBody/);
  assert.match(implementation, /forceBoundPrBody/);
  assert.match(cliRegression, /artifact_reference_fallback/);
  assert.match(cliRegression, /forced_artifact_reference_fallback/);

  // Tracked repository paths remain clickable, while Gate enforcement stays in place.
  assert.match(implementation, /function formatRepoPathLink/);
  assert.match(cliRegression, /tracked=\[Story\]\(docs\/management\/stories\/active\/story-pr-prepare\.md\)/);
  assert.match(implementation, /Pre-create gate waiver missing/);
});
