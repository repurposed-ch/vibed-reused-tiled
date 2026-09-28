## Run locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Open the Vite URL (usually `http://localhost:5173/vibed-reused-tiled/`).

```bash
bun run build    # production build → dist/
bun run preview  # preview production build
bun run test     # vitest (plain `bun test` runs Bun's own runner and fails on the @/ alias)
```

## Site structure

| URL | Source | What |
| --- | --- | --- |
| `/vibed-reused-tiled/` | `index.html` | Landing page: links to the app and the example projects |
| `/vibed-reused-tiled/app/` | `app/index.html` → `src/` | The main React app. Navigation uses a **hash router** (`#/tiles`, `#/tile-schema`, …) |
| `/vibed-reused-tiled/examples/tile-stock-sampler/` | `public/examples/tile-stock-sampler/` | **Tile Stock Image Sampler** by Harrison Hildebrandt |
| `/vibed-reused-tiled/examples/tile-patterns/` | `public/examples/tile-patterns/` | **Tile Patterns** by Moritz Funck |

Old deep links to the app root (`/vibed-reused-tiled/#/tiles`) are redirected by the landing page to `app/#/tiles`.

### Example projects

Example projects are plain static sites. Vite copies `public/` into `dist/` unchanged, so each folder under `public/examples/` needs an `index.html` at its top level.

- `tile-patterns/index.html` is Moritz Funck's generator, copied verbatim from `fliesen-verlegemuster-v6.html`.
- `tile-stock-sampler/` holds Harrison Hildebrandt's Python script, sample photos and CSV results from `Tile stock sampler.zip`. Its `index.html` is a showcase page written for this site that draws the CSV detections over the photos. `source_image.web.jpg` is a compressed copy for display.

## Deploy (GitHub Pages)

Site: [https://repurposed-ch.github.io/vibed-reused-tiled/](https://repurposed-ch.github.io/vibed-reused-tiled/)

- Vite `base` is `/vibed-reused-tiled/`
- Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds with Bun and deploys `dist/`
- In the repo: **Settings → Pages → Source = GitHub Actions**

## Architecture

See [`architecture.md`](architecture.md) for schemas, workflow layers, design-family UI, LLM assist, and the phase plan.

## LLM assist (optional)

1. Open `app/#/settings` and pick a **provider** + **model**. Default is OVHcloud (no API key).
2. Enter an API key only when the provider requires one. Keys stay in `localStorage`.
3. Free-tier catalog inspired by [awesome-free-llm-apis](https://github.com/mnfst/awesome-free-llm-apis) (linked from Settings).
4. Optional build defaults: `VITE_LLM_PROVIDER` / `VITE_LLM_MODEL` (see [`.env.example`](.env.example)).
5. On `app/#/tile-schema`, use **Assist with LLM**. Responses must validate as `DesignFamily` JSON before apply.

Gemini uses `generateContent` + `X-goog-api-key`; other providers use OpenAI-compatible `chat/completions`. Browser CORS may block some endpoints — switch provider if needed. For production, prefer a small proxy that holds secrets.
