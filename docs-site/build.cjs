#!/usr/bin/env node
/**
 * Zero-dependency docs site generator.
 * Uses only Node builtins so Vercel never needs package installs.
 */
const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const root = __dirname;
const workspace = join(root, "..");
const output = join(root, "out");
const assets = join(root, "assets");

const pages = [
  ["index", null, "Home", "home"],
  ["quick-start", "docs/api-reference.md", "Quick Start", "docs"],
  ["api", "docs/api-reference.md", "API", "docs"],
  ["architecture", "docs/architecture.md", "Architecture", "docs"],
  ["storage", "docs/storage-adapters.md", "Storage", "docs"],
  ["sync", "docs/sync-engine.md", "Sync", "docs"],
  ["plugins", "docs/plugins.md", "Plugins", "docs"],
  ["contracts", "docs/public-contracts.md", "Contracts", "docs"],
  ["practices", "docs/best-practices.md", "Practices", "docs"],
  ["roadmap", "docs/roadmap-implementation.md", "Roadmap", "docs"],
  ["faq", "docs/faq.md", "FAQ", "docs"]
];

const navPages = pages.filter(([slug]) => slug !== "index");

function main() {
  assertExists(assets, "docs-site/assets");
  assertExists(join(workspace, "docs"), "docs/");

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(assets, join(output, "assets"), { recursive: true });

  writeFileSync(join(output, "index.html"), renderHome(), "utf8");

  for (const [slug, source, title] of pages) {
    if (slug === "index") {
      continue;
    }

    let markdown = readFileSync(join(workspace, source), "utf8");

    if (slug === "quick-start") {
      markdown = `# Quick Start

Install OfflineJS and start writing local-first data in minutes.

\`\`\`bash
pnpm add @offlinejs
\`\`\`

\`\`\`ts
import { createOfflineDB } from "@offlinejs";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: "indexeddb",
  sync: { conflictStrategy: "lastWriteWins" }
});

const todos = db.collection("todos");
await todos.create({ title: "Ship offline sync", completed: false });
const open = await todos.find({ filters: { completed: false } });
\`\`\`

One package covers the common path. Need something specific? Import it from \`@offlinejs\` too, or from a focused package like \`@offlinejs/storage-sqlite\`.

## What happens next

- Writes land in local storage immediately.
- Mutations enter a durable queue.
- Sync resumes when the network returns.
- Conflicts resolve with your chosen strategy.

## Keep exploring

- [API Reference](api.html)
- [Storage Adapters](storage.html)
- [Sync Engine](sync.html)
- [Plugins](plugins.html)
`;
    }

    writeFileSync(join(output, `${slug}.html`), renderDoc(title, markdown, slug), "utf8");
  }

  writeFileSync(
    join(output, "sitemap.json"),
    JSON.stringify(
      pages.map(([slug, , title]) => ({
        slug,
        title,
        url: slug === "index" ? "/" : `/${slug}.html`
      })),
      null,
      2
    ),
    "utf8"
  );

  writeFileSync(join(output, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: /sitemap.json\n", "utf8");

  // Local alias used by older scripts/docs.
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(output, dist, { recursive: true });

  console.log(`Docs site built → ${output}`);
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing required path for docs build: ${label} (${path})`);
  }
}

function shell({ title, current, body }) {
  const nav = navPages
    .slice(0, 7)
    .map(
      ([slug, , label]) =>
        `<a href="${slug}.html"${current === slug ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="OfflineJS — offline-first data layer for TypeScript and JavaScript." />
    <title>${escapeHtml(title)} · OfflineJS</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Manrope:wght@400;600;700;800&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="assets/styles.css" />
  </head>
  <body>
    <div class="site-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"></span>OfflineJS</a>
          <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">
            <span class="nav-toggle-bars" aria-hidden="true"></span>
          </button>
          <nav class="nav" id="site-nav" aria-label="Primary">${nav}<a href="faq.html"${current === "faq" ? ' aria-current="page"' : ""}>FAQ</a></nav>
        </div>
      </header>
      ${body}
      <footer class="footer">
        <div class="section-inner">
          OfflineJS keeps apps writing locally, syncing automatically, and recovering gracefully.
        </div>
      </footer>
    </div>
    <script src="assets/site.js"></script>
  </body>
</html>`;
}

function renderHome() {
  const body = `
    <section class="hero">
      <div class="hero-visual" aria-hidden="true">
        <div class="orbit orbit-1"><span class="node"></span></div>
        <div class="orbit orbit-2"><span class="node"></span></div>
        <div class="orbit orbit-3"><span class="node"></span></div>
      </div>
      <div class="hero-inner">
        <h1 class="brand-hero reveal">OfflineJS</h1>
        <p class="hero-copy reveal">
          The offline-first data layer for TypeScript apps that should keep working when the network disappears.
        </p>
        <div class="cta-row reveal">
          <a class="button button-primary" href="quick-start.html">Start building</a>
          <a class="button button-secondary" href="api.html">Read the API</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Why OfflineJS</p>
        <h2 class="section-title reveal">Local writes first. Sync when ready.</h2>
        <p class="section-copy reveal">
          Stop hand-rolling fetch retries, IndexedDB wrappers, mutation queues, and conflict logic. OfflineJS turns that complexity into a calm collection API.
        </p>
        <div class="feature-strip">
          <article class="feature reveal">
            <h3>Optimistic by default</h3>
            <p>UI updates immediately from durable local storage while mutations wait for reconnect.</p>
          </article>
          <article class="feature reveal">
            <h3>Queue with backoff</h3>
            <p>Persistent mutation queues retry with priority, pause/resume, and exponential backoff.</p>
          </article>
          <article class="feature reveal">
            <h3>Pluggable everywhere</h3>
            <p>Swap storage adapters, transports, plugins, and conflict strategies without changing your app API.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Install</p>
        <h2 class="section-title reveal">Ship the first offline collection today.</h2>
        <p class="section-copy reveal">One package for the API. One adapter for persistence. Sync comes with you.</p>
        <pre class="code-panel reveal"><code>pnpm add @offlinejs

import { createOfflineDB } from "@offlinejs";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: "indexeddb"
});

await db.collection("todos").create({ title: "Works offline" });</code></pre>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Docs</p>
        <h2 class="section-title reveal">Explore the system.</h2>
        <p class="section-copy reveal">Architecture, adapters, sync, plugins, contracts, and the roadmap—all in one place.</p>
        <div class="cta-row reveal">
          <a class="button button-primary" href="architecture.html">Architecture</a>
          <a class="button button-secondary" href="storage.html">Storage</a>
          <a class="button button-secondary" href="sync.html">Sync</a>
          <a class="button button-secondary" href="roadmap.html">Roadmap</a>
        </div>
      </div>
    </section>
  `;

  return shell({ title: "Offline-first data layer", current: "index", body });
}

function renderDoc(title, markdown, slug) {
  const sidebar = navPages
    .map(
      ([pageSlug, , label]) =>
        `<a href="${pageSlug}.html"${pageSlug === slug ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`
    )
    .join("");

  const body = `
    <div class="page doc-layout">
      <aside class="sidebar reveal" aria-label="Documentation">
        ${sidebar}
      </aside>
      <article class="content reveal">
        ${markdownToHtml(markdown)}
      </article>
    </div>
  `;

  return shell({ title, current: slug, body });
}

function markdownToHtml(markdown) {
  const fenced = [];
  let html = markdown.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODE_${fenced.length}@@`;
    fenced.push(`<pre><code>${escapeHtml(code.replace(/^\w+\n/, "").trim())}</code></pre>`);
    return token;
  });

  html = escapeHtml(html)
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^\|(.+)\|$/gm, (row) => {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) {
        return "@@TABLE_DIVIDER@@";
      }
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    })
    .replace(/(?:<tr>.*<\/tr>\n?)+/g, (block) => {
      const cleaned = block.replace(/@@TABLE_DIVIDER@@\n?/g, "");
      const withHeader = cleaned.replace(
        /<tr>(.*?)<\/tr>/,
        (_match, first) =>
          `<thead><tr>${first.replaceAll("<td>", "<th>").replaceAll("</td>", "</th>")}</tr></thead><tbody>`
      );
      return `<table>${withHeader}</tbody></table>`;
    })
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(?:<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<p><h/g, "<h")
    .replace(/<\/h([1-3])><\/p>/g, "</h$1>")
    .replace(/<p><ul>/g, "<ul>")
    .replace(/<\/ul><\/p>/g, "</ul>")
    .replace(/<p><table>/g, "<table>")
    .replace(/<\/table><\/p>/g, "</table>")
    .replace(/<p>\s*<\/p>/g, "");

  fenced.forEach((block, index) => {
    html = html.replace(`@@CODE_${index}@@`, block).replace(`<p>${block}</p>`, block);
  });

  return html;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

try {
  main();
} catch (error) {
  console.error("Docs build failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}
