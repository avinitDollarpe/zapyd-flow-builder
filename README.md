# Zapyd flow builder

Pick a source and a destination and see every Zapyd API call in order: a chained flow on a canvas, plus numbered cURL steps against the sandbox. The docs embed it in an iframe on the **Flow builder** tab (`flow-builder.mdx` in the docs repo).

```bash
npm install
npm run dev      # http://localhost:5180 (the docs page uses this port on localhost)
npm run check    # builds every source/destination/option combination and checks each flow
npm run build    # static site in dist/
```

## How it works

- `src/data/markets.json`: markets, payout rails, sample values and stablecoin networks. Its payout rails and samples mirror the country data in the docs repo (`scripts/gen-country-guides.py`). Update both when a market or rail changes.
- `src/flow.ts`: turns the chosen options into canvas groups, edges and code steps. All API knowledge lives here.
- `src/Canvas.tsx`: the chained cards. Wires are measured from the rendered cards, so cards can grow freely. Drag or scroll to pan, Ctrl or Cmd plus scroll to zoom.
- `src/Code.tsx`: the numbered steps and cURL.
- `src/Demo.tsx`: the UI preview at `?view=demo` (the docs **UI Preview** tab). A sample app runs a generic journey: sign up with email and phone OTPs (the phone's country is the KYC country), KYC for that country with a sandbox auto-verify shortcut, a calculator with the same pickers as the Flow Builder, a review, then the `flow.ts` steps for the chosen route. It logs each call, response and webhook. Nothing is sent: responses come from `src/data/responses.json`, copied from the response examples in the docs repo's `endpoint/*/apiEndpoints.json` and filled in with the request. Copy them again when a response shape changes.
- `src/prompt.ts`: the AI agent prompt for a flow. Its signing and webhook rules match the endpoint prompts in the docs repo (`scripts/gen-endpoint-prompts.py`).

## Embedding

| Query or message | Effect |
| --- | --- |
| `?view=demo` | Shows the demo instead of the flow builder |
| `?embed=1` | Hides the logo and the footer |
| `?theme=light` or `?theme=dark` | Initial theme |
| `postMessage({ type: 'zapyd:theme', theme })` | Switches theme live. The docs page sends it when the reader toggles dark mode |
| `#src=USDT&dst=MXN&...` | The selected flow. It is kept in the URL, so flows can be linked |

Icons are from [Lucide](https://lucide.dev) (ISC). Flags are from [flagcdn](https://flagcdn.com), self-hosted in `public/flags`.
