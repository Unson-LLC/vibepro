---
layout: home

hero:
  name: VibePro
  text: Bring the reason for a change into its PR.
  tagline: Investigate what should change with your AI host, then connect the reasoning to Stories, Specs, implementation, and PR review.
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Try one change
      link: /guide/getting-started
    - theme: alt
      text: What VibePro Is
      link: /guide/what-is-vibepro
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: Investigate what should change
    details: Frame questions with your AI host, inspect code structure and source, and revise options and recommendations with evidence. Keep unknowns explicit.
  - title: Connect behavior to evidence
    details: Describe concrete behavior in a Spec and link it to the code and tests that should implement and verify it.
  - title: Make the PR easier to review
    details: Keep verification and review records with the change, then prepare a PR summary that shows how the implementation connects back to the Story and Spec.
---

## From deciding what to build to reviewing the change

A request does not always call for a new feature. With [Senior Engineering Judgment](/guide/senior-engineering-judgment), `judgment investigate` helps the AI host frame questions from the goal and scope, inspect existing Graphify artifacts and source, and revisit the problem, options, and recommendations as evidence changes. Candidates can then enter explicit input adoption and evaluation to consider what to build, simplify, or validate first. This investigation is optional, not a requirement for every change.

## A PR should explain more than what changed

AI coding agents can produce a clean diff while solving the wrong user problem. VibePro keeps the few links a reviewer needs to answer: what user need motivated this change, what behavior was agreed, where is it implemented, and what was actually checked?

For example, a Story might say that a CSV export must preserve the active filters. The Spec can make that behavior concrete and name the code and test references. The verification record shows which test ran, and the PR summary brings those pieces back into the review conversation.

VibePro checks whether declared implementation and test references are structurally present. The AI host can interpret evidence and compare options, but the CLI does not autonomously call a model or guarantee correct judgment. A reference can exist and a test can pass while the change still misses the user's need. Human review and adoption responsibility remain.

## A deliberate boundary

Story and Spec records are an additional maintenance cost. They are the machine-readable contract VibePro can inspect; they do not replace a README, an issue tracker, product discussion, or normal code review. README or issue context alone is not a supported replacement for these records. If an existing PR explanation is already sufficient, the additional maintenance may cost more than it returns.

The former broad Gate DAG and its merge-blocking lifecycle machinery are retired from the minimal core. The current judgment DAG supports investigation, reconsideration, and next actions as advice. It does not automatically certify intent alignment or safety, approve PRs, or grant merge authority.

The [getting-started guide](/guide/getting-started) walks through the smallest useful flow. [What VibePro Is](/guide/what-is-vibepro) explains the records and their boundaries in more detail.
