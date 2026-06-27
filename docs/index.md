---
layout: home

hero:
  name: VibePro
  text: Manual for safer AI-driven PRs
  tagline: A CLI that sits between AI coding agents and GitHub PRs, making intent, specifications, evidence, reviews, and release readiness inspectable.
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Read the Manual
      link: /guide/what-is-vibepro
    - theme: alt
      text: First Run
      link: /guide/getting-started
    - theme: alt
      text: CLI Reference
      link: /reference/cli

features:
  - title: Fix intent before code
    details: State the product purpose, design assumptions, and acceptance criteria before implementation starts.
  - title: Expand gates by risk
    details: Add the right checks when changes touch UI flows, runtime topology, APIs, data, release operations, or agent workflows.
  - title: Keep review evidence
    details: Store PR context, gate state, split plans, verification records, and review artifacts under `.vibepro/`.
---

## How to Read This Manual

Start with [What VibePro Is](/guide/what-is-vibepro), then run through [Install and First Run](/guide/getting-started). Operators who already have a working repository usually need [AI PR Workflow](/guide/ai-pr-workflow), [Gates and Evidence](/guide/gates-and-evidence), and [Impact Context Integrations](/guide/graphify-impact).

The manual source lives in this repository and is built with VitePress. Cloudflare Pages is only the current hosting target; the product concepts do not depend on Cloudflare.
