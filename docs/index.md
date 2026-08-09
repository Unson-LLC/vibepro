---
layout: home

hero:
  name: VibePro
  text: Keep AI coding context traceable
  tagline: A small repository-local CLI for Story, Spec, verification, review, decision, trace, and PR evidence.
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Install the Beta
      link: /guide/getting-started
    - theme: alt
      text: See the Minimal Flow
      link: /guide/control-loop
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: Product intent stays inspectable
    details: Keep Stories and Specs beside the repository so an agent's implementation can be traced back to intended behavior.
  - title: Evidence stays explicit
    details: Record verification, review, and human decisions without converting those records into an automatic safety verdict.
  - title: PR handoff stays readable
    details: Summarize the current repository-local evidence into machine-readable PR context and a human-readable PR body.
---

## The 0.2.0-beta.3 boundary

VibePro is now a minimal evidence workspace. It no longer provides Gate DAGs, readiness/blocking verdicts, managed merge execution, lifecycle accounting, per-Story delivery-efficiency budget enforcement, or automatic audit bundles. Human reviewers and repository policy remain responsible for approval and merge.

The narrower Development Control Loop measures adopted batches and constrains only the next Story intent. It starts in `shadow`, which reports mismatches without stopping work. A repository can explicitly opt into `enforced` after migrating active Stories; only that mode may block Story planning, `pr prepare`, or `pr create` on an intent mismatch. It does not approve or merge a PR.

[What VibePro Is](/guide/what-is-vibepro) explains the boundary. [Version History](/reference/version-history) separates the published package from development history.
