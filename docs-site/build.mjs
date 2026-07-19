import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const workspace = join(root, "..");
const output = join(root, "dist");

const pages = [
  ["index", "README.md", "OfflineJS"],
  ["api", "docs/api-reference.md", "API Reference"],
  ["architecture", "docs/architecture.md", "Architecture"],
  ["storage-adapters", "docs/storage-adapters.md", "Storage Adapters"],
  ["sync-engine", "docs/sync-engine.md", "Sync Engine"],
  ["plugins", "docs/plugins.md", "Plugins"],
  ["public-contracts", "docs/public-contracts.md", "Public Contracts"],
  ["best-practices", "docs/best-practices.md", "Best Practices"],
  ["roadmap", "docs/roadmap-implementation.md", "Roadmap Implementation"],
  ["faq", "docs/faq.md", "FAQ"]
];

await mkdir(output, { recursive: true });

for (const [slug, source, title] of pages) {
  const markdown = await readFile(join(workspace, source), "utf8");
  await writeFile(join(output, `${slug}.html`), renderPage(title, markdown));
}

await writeFile(
  join(output, "sitemap.json"),
  JSON.stringify(
    pages.map(([slug, , title]) => ({ slug, title, url: `${slug}.html` })),
    null,
    2
  )
);

function renderPage(title, markdown) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | OfflineJS</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; background: Canvas; color: CanvasText; }
      header { border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: 24px; }
      nav { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
      nav a { color: LinkText; text-decoration: none; }
      main { max-width: 980px; padding: 24px; }
      pre { overflow: auto; padding: 16px; background: color-mix(in srgb, CanvasText 8%, transparent); border-radius: 8px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: 8px; text-align: left; }
    </style>
  </head>
  <body>
    <header>
      <strong>OfflineJS</strong>
      <nav>
        ${pages
          .map(([slug, , label]) => `<a href="${slug}.html">${escapeHtml(label)}</a>`)
          .join("")}
      </nav>
    </header>
    <main>${markdownToHtml(markdown)}</main>
  </body>
</html>`;
}

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  return escaped
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p><h/g, "<h")
    .replace(/<\/h([1-3])><\/p>/g, "</h$1>")
    .replace(/<p><pre>/g, "<pre>")
    .replace(/<\/pre><\/p>/g, "</pre>");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
