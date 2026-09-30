# Vector Studio — Vector Ink Trace + Hector Vector Canvas

A new, intentionally small integration of **two features**:

1. **Trace Image:** prepare PNG/JPG/WebP with the exact image sizing, transparency and seven tracing options established in NEXORA V1; call Vector Ink through this project's **own Netlify Function**.
2. **Vector Canvas:** the unmodified core of open-source [Hector Vector](https://github.com/asuramaya/hector-vector) handles pen, nodes, fills, gradients, groups, zoom, undo/redo and export. A slim dark toolbar adds the one-click Trace Image workflow.

**One workflow:** choose raster image → adjust three optional controls → Trace → sanitized SVG **automatically enters the actual editor**, never as an `<image>` raster placeholder. On an empty canvas the traced SVG becomes the active editable document with its original `<defs>` and original vector geometry. If a canvas already contains artwork, a grouped SVG is added without overwriting it; gradients and other local references are renamed to avoid collisions. Existing history supports Undo.

## Quick deploy: Netlify + GitHub

Upload the **contents of this source ZIP** to a **new GitHub repository** (keep `netlify.toml` at repository root). Then in [Netlify](https://app.netlify.com/start):

1. **Add new project → Import an existing project → GitHub** and select your new repository.
2. Select `main`; **Netlify reads `netlify.toml` automatically**. Build: `bash scripts/build-netlify.sh`; publish: `dist`; Functions: `netlify/functions`.
3. Click **Deploy**. The trace endpoint lives on your own site at `/api/trace`.

No Python server, Vercel/NEXORA V1 infrastructure, Cloudflare hosting, npm build step, or API key is required by the *code*. **Vector Ink is a third-party service:** it must allow calls from your deployment; it may refuse unauthorized requests or change its endpoint/usage terms. Confirm authorization/terms and test one trace after deployment. The old NEXORA V1 project's auth protections are not inherited by this independent app.

### Public-use safety and optional CAPTCHA

Native Netlify rate limiting caps `/api/trace` to **8 requests per minute per IP/domain**, including status requests. This mitigates accidental spikes but is not a global budget or distributed-attack safeguard. Before sharing a high-traffic public app, configure [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) *only as CAPTCHA* (still host at Netlify). Set BOTH environment variables in Netlify (mark secret appropriately):

- `TRACE_TURNSTILE_SITE_KEY` — site key for your `*.netlify.app` or custom domain.
- `TRACE_TURNSTILE_SECRET` — secret server key; never put it into frontend code or GitHub.

Without those variables, tracing works with Netlify's per-IP limit and same-origin request check. Set `TRACE_ENABLED=false` to disable the paid/remote workload instantly if necessary. Use Netlify's native app usage dashboard to monitor usage. No provider authorization is bypassed.

### Accuracy and fidelity

The frontend mirrors V1: original upload max 12 MB; initial resize max 1600px / 2.2 MP, retry 960px / 650K; PNG/WebP alpha is preserved where possible; output blob ≤ 2,050 KiB; Base64 ≤ 2.8M chars. Its request matches the V1 payload `JSON.stringify({ data: { image, speckleSize, colorPrecision, cornerThreshold, segmentLength, spliceThreshold, maxIterations, pathPrecision } })` with 35s initial request and a bounded transient retry. This does not pretend to implement Vector Ink's proprietary internal tracer.

### Test before publishing

`node tests/trace-backend.mjs` tests the **real Netlify handler with a mocked external Vector Ink response**, origin/magic-byte guards, retry, defaults and optional CAPTCHA.

`node tests/trace-preprocess.mjs` checks frontend image preprocessing with a deterministic browser-canvas harness.

`bash scripts/build-netlify.sh` packages only static `web/`, `src/` and `assets/` into `dist/`; the Netlify Function stays server-side.

`python tests/browser-e2e.py` (requires local Playwright/Chromium, the fixture image, and `python3 -m http.server 8976 --directory dist`) checks Android viewport layouts and the full frontend workflow with a mocked **HTTP** response. This does not validate real Vector Ink availability; a permitted live test on Netlify is required to confirm that external service.

## Licensing

Hector Vector source is MIT, copyright © 2026 asuramaya; original [`LICENSE`](LICENSE) remains intact. This app modifies the integration/UI on top of its canvas. All code runs separately from NEXORA V1; no changes to the user's existing production projects.
