# AGENTS.md

Instructions for AI coding agents (Claude Code, Cursor, Codex and others) working in this repository. `CLAUDE.md` imports this file. `README.md` covers how the app works and how it's embedded.

## What this is

A Vite and React app with two views, both embedded in the Zapyd docs (the docs repo sits next to this one in `~/Desktop/personal/misc/all docs/docs`, rules in its `AGENT.md`):

- **Flow Builder** (default view, docs tab `flow-builder.mdx`): pick a source and a destination and see every Zapyd API call in order, as a canvas and as numbered cURL steps, plus an AI agent prompt.
- **UI Preview** (`?view=demo`, docs tab `demo.mdx`): a sample app that walks a user through sign-up, KYC, a calculator and the order, logging each call, response and webhook. It sends nothing.

Pushes to `main` deploy to `https://zapyd-flow-builder.vercel.app`, which the docs embed, so `main` is production.

## Commands

```bash
npm install
npm run dev      # http://localhost:5180 (the docs pages use this port on localhost)
npm run lint     # oxlint
npm run check    # builds every source, destination and option combination and checks each flow
npm run build    # type-check and build to dist/
```

## Where things live

| File | What it holds |
| --- | --- |
| `src/flow.ts` | Options, pickers and `build()`: turns the chosen options into canvas groups, edges and code steps. All API knowledge lives here |
| `src/data/markets.json` | Markets, payout rails, sample values and stablecoin networks |
| `src/data/responses.json` | UI Preview responses, keyed by step |
| `src/prompt.ts` | The AI agent prompt for a flow |
| `src/App.tsx` | Flow Builder layout and option panel |
| `src/Canvas.tsx`, `src/Code.tsx` | The chained cards and the numbered cURL steps |
| `src/Demo.tsx` | The UI Preview |
| `src/icons.tsx` | Inline Lucide icon paths |
| `src/styles.css`, `src/theme.ts` | Styles and light/dark theme |
| `scripts/check.ts` | `npm run check`: every combination, plus spot checks on the rules the docs set |
| `public/` | Logos, fonts, self-hosted flags and network icons |

## Keep in step with the docs repo

The docs are the source of truth for API shapes and product rules; this app mirrors them.

- **Payout rails and samples** in `src/data/markets.json` mirror `scripts/gen-country-guides.py` in the docs repo. Change both together.
- **Responses** in `src/data/responses.json` are copied from the response examples in the docs repo's `api-reference-exchange/endpoint/*/apiEndpoints.json`. Copy them again when a response shape changes.
- **Status codes:** payin and payout `quotation` and `initiate` (`POST /pis/…` and `/pos/…`) answer `201 Created`; every other call answers `200 OK` (`httpStatus` in `src/Demo.tsx`).
- **Agent prompt:** the signing and webhook rules in `src/prompt.ts` match `scripts/gen-endpoint-prompts.py` and `guides/getting-started/build-with-ai.mdx` in the docs repo.
- **Docs links:** every `docs:` path in a step must be a live page in the docs repo (check its `docs.json`). `docsUrl` prefixes them with `DOCS` in `src/flow.ts`, the Mintlify host until `docs.zapyd.com` is live.
- **Embedding contract:** the query parameters, hash format and `postMessage` theme message in `README.md` are used by the docs pages. Don't change them without updating `flow-builder.mdx` and `demo.mdx`.

## Product rules

The same rules as the docs (see the docs repo's `AGENT.md`, "Product language"). The ones that bite here:

- Zapyd branding only, and never name or allude to service providers (payout partners, banks, KYC vendors) or internal routing. The UI Preview's phone shows the partner's app ("Your app", with an uploadable logo), not Zapyd.
- Payments are for individuals only.
- Two payout models: per order (`transaction_hash`) and prefunded. Never show the internal exchange-organization flow.
- Fiat to fiat is cross-border: a payin to USDC, then a payout. Into INR there are two options, a standard payout or the RDA remittance API (the "India payout" setting); every other market uses a standard payout with `transfer_purpose`.
- KYC sharing reads `GET /kyc/configuration/{customer_id}` before `add-kyc-data`.
- The Flow Builder offers USDC as the stablecoin; the UI Preview also offers USDT. Say "stablecoins" in copy, not "USDT or USDC".

## Code

- Put API behavior in `src/flow.ts`, not in the views. When you change a rule the docs set, add or update a spot check at the end of `scripts/check.ts`.
- No new dependencies for what a few lines can do. Icons are Lucide paths added to `src/icons.tsx`.
- Keep both themes working, keep the canvas usable with keyboard and pointer, and respect `prefers-reduced-motion`.

## Before you finish

1. `npm run lint` (no errors), `npm run check` and `npm run build` all pass.
2. Look at the change in `npm run dev`, in both views and both themes when it touches the UI. If the docs repo runs `mint dev`, check the embedded tabs too.

## Commits

- Commit only when asked. Use Conventional Commits: `type(scope): summary`, lowercase, no full stop (for example `feat(flow): …`, `fix(demo): …`, `fix(check): …`, `chore: …`).
- One commit per task. When a working tree holds several tasks, stage each task's files and hunks separately and commit them in the order they were done.
- Never add a `Co-Authored-By` trailer or any other AI attribution to commit messages or PR descriptions.
- Never commit with a failing check: run `npm run lint`, `npm run check` and `npm run build` first, and fix what fails even when your change didn't cause it.
