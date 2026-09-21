---
layout: home

hero:
  name: VibePro
  text: Bring the reason for a change into its PR.
  tagline: A CLI for turning what a change is meant to achieve, where it is implemented, and what was checked into a PR-ready review summary.
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
  - title: Start with the user's need
    details: Record the user problem and acceptance criteria in a Story, so an AI-assisted change has a product reason to return to.
  - title: Connect behavior to evidence
    details: Describe concrete behavior in a Spec and link it to the code and tests that should implement and verify it.
  - title: Make the PR easier to review
    details: Keep verification and review records with the change, then prepare a PR summary that shows how the implementation connects back to the Story and Spec.
---

## A PR should explain more than what changed

AI coding agents can produce a clean diff while solving the wrong user problem. VibePro keeps the few links a reviewer needs to answer: what user need motivated this change, what behavior was agreed, where is it implemented, and what was actually checked?

For example, a Story might say that a CSV export must preserve the active filters. The Spec can make that behavior concrete and name the code and test references. The verification record shows which test ran, and the PR summary brings those pieces back into the review conversation.

VibePro can inspect whether declared implementation and test references are structurally present, but it cannot decide whether the behavior is semantically right. A reference can exist and a test can pass while the change still misses the user's need; people must read the Story, behavior, and result together.

## A deliberate boundary

Story and Spec records are an additional maintenance cost. They are the machine-readable contract VibePro can inspect; they do not replace a README, an issue tracker, product discussion, or normal code review. README or issue context alone is not a supported replacement for these records. If an existing PR explanation is already sufficient, the additional maintenance may cost more than it returns.

The former broad Gate DAG and its merge-blocking lifecycle machinery are retired from the minimal core. Optional Development Judgment tools can help compare approaches and record a disposition, but they are advisory context—not automatic intent-drift detection, safety certification, PR approval, or merge authority.

The [getting-started guide](/guide/getting-started) walks through the smallest useful flow. [What VibePro Is](/guide/what-is-vibepro) explains the records and their boundaries in more detail.
