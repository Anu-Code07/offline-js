# OfflineJS Docs Site

Static documentation site for OfflineJS.

## Local development

```bash
pnpm docs:build
pnpm dlx serve docs-site/dist
```

## Vercel

Root `vercel.json` is already configured:

- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm docs:build`
- Output: `docs-site/dist`

Import the GitHub repo in Vercel, keep Root Directory as `.`, and deploy.
