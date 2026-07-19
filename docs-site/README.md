# OfflineJS Docs Site

Static documentation site for OfflineJS.

## Local development

```bash
pnpm docs:build
pnpm dlx serve docs-site/dist
```

## Vercel

Root `vercel.json` is already configured:

- Install: skipped (docs generator is zero-dependency Node)
- Build: `node docs-site/build.mjs`
- Output: `docs-site/dist`

Import the GitHub repo in Vercel, keep Root Directory as `.`, and deploy.

If the Vercel project has an overridden Build Command in Project Settings,
clear it (or set it to `node docs-site/build.mjs`) so `vercel.json` is used.
