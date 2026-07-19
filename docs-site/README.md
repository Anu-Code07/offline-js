# OfflineJS Docs Site

Static documentation site for OfflineJS.

## Local development

Regenerate the static export (writes `out/` + local `dist/`):

```bash
pnpm docs:build
# or from this folder:
node build.cjs
```

Preview:

```bash
pnpm dlx serve docs-site/out
```

## Vercel (failure-proof)

The site is **prebuilt** into `docs-site/out` and committed to git.

Vercel does **not** install packages and does **not** compile TypeScript. It only publishes `docs-site/out`.

### Recommended project settings

Use **one** of these setups (not a mix):

#### Option A — Root Directory = `.` (repo root)

- Framework Preset: **Other**
- Install Command: leave blank / use `vercel.json` (`true`)
- Build Command: leave blank / use `vercel.json` (`true`)
- Output Directory: `docs-site/out`
- Clear Build Cache on redeploy

#### Option B — Root Directory = `docs-site`

- Framework Preset: **Other**
- Install / Build: use `docs-site/vercel.json` (`true`)
- Output Directory: `out`
- Clear Build Cache on redeploy

### After changing docs content

```bash
pnpm docs:build
git add docs-site/out
git commit -m "Update docs site"
git push
```
