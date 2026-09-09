## Run locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Open the Vite URL (usually `http://localhost:5173/vibed-reused-tiled/`). Navigation uses a **hash router** (`#/tiles`, `#/design-family`, …).

```bash
bun run build    # production build → dist/
bun run preview  # preview production build
bun test         # vitest
```

## Deploy (GitHub Pages)

Site: [https://repurposed-ch.github.io/vibed-reused-tiled/](https://repurposed-ch.github.io/vibed-reused-tiled/)

- Vite `base` is `/vibed-reused-tiled/`
- Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds with Bun and deploys `dist/`
- In the repo: **Settings → Pages → Source = GitHub Actions**

## Architecture

See [`architecture.md`](architecture.md) for schemas, workflow layers, design-family UI, LLM assist, and the phase plan.

## LLM assist (optional)

1. Open `#/settings` and set a Gemini API key (and model if needed). Keys stay in `localStorage`.
2. Or set `VITE_GEMINI_MODEL` at build time for the default model (see [`.env.example`](.env.example)).
3. On `#/design-family`, use **Assist with LLM**. Responses must validate as `DesignFamily` JSON before apply.

The browser calls Google `generateContent` with `X-goog-api-key`. Create a key in [Google AI Studio](https://aistudio.google.com/apikey) and rotate any key that was shared. For production, prefer a small proxy that holds the provider secret (CORS / key restrictions can block browser calls).
