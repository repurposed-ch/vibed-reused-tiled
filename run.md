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

1. Open `#/settings` and pick a **provider** + **model**. Default is OVHcloud (no API key).
2. Enter an API key only when the provider requires one. Keys stay in `localStorage`.
3. Free-tier catalog inspired by [awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) (linked from Settings).
4. Optional build defaults: `VITE_LLM_PROVIDER` / `VITE_LLM_MODEL` (see [`.env.example`](.env.example)).
5. On `#/design-family`, use **Assist with LLM**. Responses must validate as `DesignFamily` JSON before apply.

Gemini uses `generateContent` + `X-goog-api-key`; other providers use OpenAI-compatible `chat/completions`. Browser CORS may block some endpoints — switch provider if needed. For production, prefer a small proxy that holds secrets.
