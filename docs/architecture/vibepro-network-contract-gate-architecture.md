---
story_id: story-vibepro-network-contract-gate
title: Network Contract Gate Architecture
---

# Network Contract Gate Architecture

## Components

- `network-contract-scanner`: scans source files for `/api/...` client calls, inventories Next.js API route files, matches calls to route contracts, and compares PR base/head when available.
- `diagnostic-engine`: stores `network_contracts` evidence and converts missing route or risky replacement signals into findings.
- `pr-manager`: adds `gate:network_contract` to Gate DAG and renders Network Contract evidence in PR body.
- `flow-verifier`: instruments generated Playwright specs to fail on API response errors, HTML API responses, console/page errors, and known visible failure text.
- `html-report`: renders a Network Contract Findings section in PR prepare HTML.

## Generalization

The scanner is framework-aware but product-agnostic. It understands Next.js App Router and Pages Router route conventions, dynamic route segments, and common API client call shapes such as `fetch`, `axios`, `apiFetch`, `requestJson`, and method wrappers.

example travel app's `/api/detail-search` incident is only a regression fixture. Production logic must not depend on example travel app file names, route names, Japanese error copy, or hotel-search domain concepts beyond the generic visible-error pattern list used by flow verification.

## Gate Policy

- Missing route for static API client call: `Critical` finding, `gate:network_contract=failed`.
- Dynamic API path that cannot be proven statically: review item.
- Server function to HTTP API replacement: high-risk PR evidence item.
- New API client call with route present: route contract passes, but PR still asks for network-aware E2E evidence.
