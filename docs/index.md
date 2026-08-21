---
layout: home

hero:
  name: VibePro
  text: Ship what you meant to build
  tagline: Keep the chain from product intent to Story, Spec, implementation, verification, decisions, and PR handoff explicit for AI-assisted development.
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Install the Beta
      link: /guide/getting-started
    - theme: alt
      text: What VibePro Is
      link: /guide/what-is-vibepro
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: Keep product intent attached to the work
    details: Connect Stories and Specs to implementation and test references so technically valid code can still be checked against what the product was meant to become.
  - title: Make intent drift inspectable
    details: Record verification, review, trace, and explicit decisions so humans and coding agents can see where implementation diverges from the accepted Story or Spec.
  - title: Hand off evidence, not an automatic verdict
    details: Summarize intent-to-implementation evidence for PR review while leaving product meaning, approval, and merge authority with people and repository policy.
---

## Intent and traceability, not agent permissions

VibePro is not primarily an agent sandbox or tool-permission system. Restricting whether an agent may use Bash, Edit, or deploy controls execution capability; VibePro addresses a different failure mode: a constrained agent can still build the wrong thing.

The current minimal core keeps the chain from Story to Spec, implementation references, verification, review, decisions, trace, and PR handoff repository-local and inspectable. It does not autonomously decide product meaning or certify that a change is safe.

## The minimal-core boundary

VibePro no longer provides the former broad Gate DAG, managed execution controller, review-lifecycle accounting, delivery-efficiency budget enforcement, or automatic audit bundles. That reduction is deliberate: the core focuses on preserving product intent and the evidence needed to review whether implementation still matches it.

[What VibePro Is](/guide/what-is-vibepro) explains the boundary. [Version History](/reference/version-history) separates the published package from development history.
