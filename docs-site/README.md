# OfflineJS Docs Site

Static documentation site for OfflineJS.

## Local development

```bash
pnpm docs:build
pnpm dlx serve docs-site/out
```

`pnpm docs:build` writes the static site to `docs-site/out` (committed) and mirrors it to `docs-site/dist` (gitignored).

## Vercel

Root `vercel.json` deploys the **prebuilt** `docs-site/out` folder:

- Install: skipped
- Build: verifies `docs-site/out` exists (no Node package installs)
- Output: `docs-site/out`

### Project settings checklist

In the Vercel project, keep these cleared/overridden values aligned with the repo:

1. **Root Directory:** `.` (repository root)
2. **Framework Preset:** Other
3. **Install Command:** use `vercel.json` (do not force `pnpm install`)
4. **Build Command:** use `vercel.json`
5. **Output Directory:** `docs-site/out`
6. Redeploy with **Clear cache** after changing these settings

When you change docs content, run `pnpm docs:build` and commit the updated `docs-site/out` files.
