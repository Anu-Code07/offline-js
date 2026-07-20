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
  ["demo", null, "Demo", "demo"],
  ["quick-start", "docs/api-reference.md", "Quick Start", "docs"],
  ["api", "docs/api-reference.md", "API", "docs"],
  ["architecture", "docs/architecture.md", "Architecture", "docs"],
  ["storage", "docs/storage-adapters.md", "Storage", "docs"],
  ["sync", "docs/sync-engine.md", "Sync", "docs"],
  ["benchmarks", "docs/benchmarks.md", "Benchmarks", "docs"],
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

  writeFileSync(join(output, "index.html"), renderHome(loadBenchmarkHighlights()), "utf8");
  writeFileSync(join(output, "demo.html"), renderDemo(), "utf8");

  for (const [slug, source, title] of pages) {
    if (slug === "index" || slug === "demo") {
      continue;
    }

    let markdown = readFileSync(join(workspace, source), "utf8");

    if (slug === "quick-start") {
      markdown = `# Quick Start

Install OfflineJS and start writing local-first data in minutes.

\`\`\`bash
pnpm add @offlinejs/client
\`\`\`

\`\`\`ts
import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: OfflineStorage.IndexedDB,
  sync: { conflictStrategy: ConflictStrategyName.LastWriteWins }
});

const todos = db.collection("todos");
await todos.create({ title: "Ship offline sync", completed: false });
const open = await todos.find({ filters: { completed: false } });
\`\`\`

One package covers the common path: \`@offlinejs/client\`. Prefer enums like \`OfflineStorage.IndexedDB\` over raw strings. Need a smaller bundle? Import a focused package like \`@offlinejs/storage-sqlite\`, \`@offlinejs/broadcast\`, or \`@offlinejs/sw\`.

## What happens next

- Writes land in local storage immediately.
- Mutations enter a durable outbox queue.
- Sync resumes when the network returns.
- Conflicts resolve with your chosen strategy.

## See it visually

The [live demo](demo.html) uses a warehouse stock board — device → outbox → remote API — so you can watch queue flush and conflict resolution with real \`@offlinejs/devtools\` events.

## Keep exploring

- [API Reference](api.html)
- [Storage Adapters](storage.html)
- [Sync Engine](sync.html)
- [Plugins](plugins.html)
- [Roadmap](roadmap.html)
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

function shell({ title, current, body, head = "", scripts = "" }) {
  const nav = navPages
    .slice(0, 8)
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
    ${head}
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
    ${scripts}
  </body>
</html>`;
}

function loadBenchmarkHighlights() {
  const candidates = [
    join(assets, "benchmark-results.json"),
    join(workspace, "docs/benchmark-results.json")
  ];

  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      const scores = Array.isArray(report.scores) ? report.scores : [];
      const pick = (adapter, metric) =>
        scores.find((score) => score.adapter === adapter && score.metric === metric);

      const memoryWrites = pick("memory", "writes");
      const memoryIndexed = pick("memory", "indexed-find");
      const idbIndexed = pick("indexeddb", "indexed-find");
      const sqliteIndexed = pick("sqlite", "indexed-find");
      const datasetSize = report.adapters?.[0]?.datasetSize ?? 10_000;

      return {
        datasetSize,
        generatedAt: report.generatedAt,
        items: [
          memoryWrites
            ? {
                label: "Memory writes",
                value: formatOps(memoryWrites.opsPerSecond),
                detail: "ops/s sequential set"
              }
            : null,
          memoryIndexed
            ? {
                label: "Memory indexed find",
                value: formatMs(memoryIndexed.durationMs),
                detail: "equality lookup + limit 100"
              }
            : null,
          idbIndexed
            ? {
                label: "IndexedDB indexed find",
                value: formatMs(idbIndexed.durationMs),
                detail: "browser durable adapter"
              }
            : null,
          sqliteIndexed
            ? {
                label: "SQLite indexed find",
                value: formatMs(sqliteIndexed.durationMs),
                detail: "SQL adapter path"
              }
            : null
        ].filter(Boolean)
      };
    } catch {
      // Fall through to empty highlights.
    }
  }

  return { datasetSize: 10_000, generatedAt: null, items: [] };
}

function formatOps(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${Math.round(value)}`;
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  if (value < 1) {
    return `${value.toFixed(2)}ms`;
  }
  if (value < 10) {
    return `${value.toFixed(1)}ms`;
  }
  return `${Math.round(value)}ms`;
}

function renderHome(highlights = { datasetSize: 10_000, items: [] }) {
  const benchSection =
    highlights.items.length === 0
      ? ""
      : `
    <section class="section bench-landing" aria-label="Benchmark scores">
      <div class="section-inner">
        <p class="section-kicker reveal">Benchmarks</p>
        <h2 class="section-title reveal">Measured on real adapters.</h2>
        <p class="section-copy reveal">
          ${highlights.datasetSize.toLocaleString()}-record suite against memory, IndexedDB, and SQLite — not synthetic demos.
        </p>
        <div class="bench-strip">
          ${highlights.items
            .map(
              (item, index) => `
            <article class="bench-score reveal" style="--bench-delay: ${index * 80}ms">
              <p class="bench-score-label">${escapeHtml(item.label)}</p>
              <p class="bench-score-value">${escapeHtml(item.value)}</p>
              <p class="bench-score-detail">${escapeHtml(item.detail)}</p>
            </article>`
            )
            .join("")}
        </div>
        <div class="cta-row reveal">
          <a class="button button-primary" href="benchmarks.html">See full scores</a>
          <a class="button button-secondary" href="demo.html">Watch the sync pipeline</a>
        </div>
      </div>
    </section>`;

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
          Write locally, queue mutations, sync when the link returns — one TypeScript collection API for offline-first apps.
        </p>
        <div class="cta-row reveal">
          <a class="button button-primary" href="demo.html">Watch the sync pipeline</a>
          <a class="button button-secondary" href="quick-start.html">Start building</a>
        </div>
      </div>
    </section>

    ${benchSection}

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Why OfflineJS</p>
        <h2 class="section-title reveal">Device → outbox → remote.</h2>
        <p class="section-copy reveal">
          Stop hand-rolling IndexedDB wrappers, mutation queues, retries, and conflict logic. OfflineJS turns that into a calm collection API you can see in the live stock demo.
        </p>
        <div class="feature-strip">
          <article class="feature reveal">
            <h3>Optimistic by default</h3>
            <p>UI updates immediately from durable local storage while mutations wait for reconnect.</p>
          </article>
          <article class="feature reveal">
            <h3>Durable outbox</h3>
            <p>Queued mutations retry with priority, pause/resume, and exponential backoff until they land remotely.</p>
          </article>
          <article class="feature reveal">
            <h3>Compose as you grow</h3>
            <p>Start with <code>@offlinejs/client</code>, then add broadcast, service worker, SQLite, encryption, or auth packages.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Install</p>
        <h2 class="section-title reveal">One package for the common path.</h2>
        <p class="section-copy reveal">Install <code>@offlinejs/client</code>. Prefer storage and conflict enums. Sync rides along.</p>
        <pre class="code-panel reveal"><code>pnpm add @offlinejs/client

import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: OfflineStorage.IndexedDB,
  sync: { conflictStrategy: ConflictStrategyName.LastWriteWins }
});

await db.collection("stock").create({ name: "Oat milk", qty: 12 });</code></pre>
      </div>
    </section>

    <section class="section">
      <div class="section-inner">
        <p class="section-kicker reveal">Docs</p>
        <h2 class="section-title reveal">Explore the system.</h2>
        <p class="section-copy reveal">Architecture, adapters, sync, plugins, benchmarks, DevTools, contracts, and the completed v0.2–v0.8 foundations.</p>
        <div class="cta-row reveal">
          <a class="button button-primary" href="architecture.html">Architecture</a>
          <a class="button button-secondary" href="storage.html">Storage</a>
          <a class="button button-secondary" href="benchmarks.html">Benchmarks</a>
          <a class="button button-secondary" href="plugins.html">DevTools</a>
          <a class="button button-secondary" href="roadmap.html">Roadmap</a>
        </div>
      </div>
    </section>
  `;

  return shell({ title: "Offline-first data layer", current: "index", body });
}

function renderDemo() {
  const body = `
    <main class="demo-page">
      <section class="demo-hero">
        <h1>Watch the sync pipeline</h1>
        <p>
          A warehouse stock board that makes OfflineJS visible: edit quantities on
          <strong>this device</strong>, see writes land in the <strong>outbox</strong>,
          then flush to the <strong>remote API</strong>. Cut the link, diverge quantities,
          and resolve conflicts — with real <code>@offlinejs/devtools</code> events below.
        </p>
      </section>

      <p class="demo-status" id="demo-status">Starting demo…</p>

      <section class="demo-flow" id="sync-flow" aria-label="Sync pipeline">
        <div class="demo-flow-node" data-node="device">
          <strong>This device</strong>
          <span>IndexedDB</span>
        </div>
        <div class="demo-flow-arrow" aria-hidden="true">→</div>
        <div class="demo-flow-node" data-node="outbox">
          <strong>Outbox</strong>
          <span>queued mutations</span>
        </div>
        <div class="demo-flow-arrow" aria-hidden="true">→</div>
        <div class="demo-flow-node" data-node="remote">
          <strong>Remote API</strong>
          <span id="link-state" data-state="online">link open</span>
        </div>
      </section>

      <section class="demo-toolbar" aria-label="Demo controls">
        <label class="demo-toggle">
          <input id="online-toggle" type="checkbox" checked />
          <span id="online-label">Online</span>
        </label>

        <label class="demo-field">
          Conflict strategy
          <select id="conflict-strategy">
            <option value="lastWriteWins">ConflictStrategyName.LastWriteWins</option>
            <option value="clientWins">ConflictStrategyName.ClientWins</option>
            <option value="serverWins">ConflictStrategyName.ServerWins</option>
            <option value="merge">ConflictStrategyName.Merge</option>
          </select>
        </label>

        <button class="button button-secondary" type="button" id="seed-random">Seed remote stock</button>
        <button class="button button-primary" type="button" id="sync-now">Flush outbox</button>
        <button class="button button-secondary" type="button" id="simulate-conflict">Stage conflict</button>
        <button class="button button-secondary" type="button" id="reset-demo">Reset</button>
      </section>

      <section class="demo-composer" aria-label="Add stock item">
        <input id="item-name" type="text" placeholder="New stock item (e.g. Oat milk)" />
        <input id="item-qty" type="number" min="0" value="1" aria-label="Quantity" />
        <button class="button button-primary" type="button" id="add-item">Add on device</button>
      </section>

      <div class="demo-pipeline">
        <section class="demo-panel">
          <h2>1 · This device</h2>
          <p class="demo-meta" id="device-meta">Loading IndexedDB…</p>
          <div class="demo-stack" id="device-list"></div>
        </section>

        <section class="demo-panel">
          <h2>2 · Outbox</h2>
          <p class="demo-meta" id="outbox-meta">Checking queue…</p>
          <div class="demo-stack" id="outbox-list"></div>
        </section>

        <section class="demo-panel">
          <h2>3 · Remote API</h2>
          <p class="demo-meta" id="server-meta">Fake warehouse idle.</p>
          <div class="demo-stack" id="server-list"></div>
        </section>
      </div>

      <section class="demo-panel demo-devtools-wrap">
        <h2>Package DevTools</h2>
        <p class="demo-meta">Redux-style Action / State panel from <code>createDevtoolsController(db).mount()</code> — also try <code>openOfflineDevtools(db)</code> for a floating dock.</p>
        <div class="demo-devtools" id="offlinejs-devtools"></div>
      </section>
    </main>
  `;

  return shell({
    title: "Live demo",
    current: "demo",
    body,
    head: '<link rel="stylesheet" href="assets/demo-stock.css" />',
    scripts: '<script type="module" src="assets/demo-stock.js"></script>'
  });
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
