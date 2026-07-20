# Media queue (`@offlinejs/media-queue`)

Durable **offline media uploads** for the web — think OfflineJS, but for blobs.

- User picks a file → UI can update instantly  
- Images are compressed / resized on-device  
- Upload sits in an **IndexedDB queue**  
- Survives refresh, tab close, offline, flaky networks  
- **Chunked resume** from `bytesUploaded`  
- Progress / complete / error events  

Video compression is reserved for later; video files still queue and upload in chunks.

## Install

Included with [`@offlinejs/client`](https://www.npmjs.com/package/@offlinejs/client), or:

```bash
pnpm add @offlinejs/media-queue
# npm i @offlinejs/media-queue
```

## Quick start

```ts
import { createMediaQueue } from "@offlinejs/client";

const media = createMediaQueue({
  endpoint: "/api/uploads",
  databaseName: "my-app-media",
  chunkSize: 256 * 1024,
  compress: {
    images: { maxWidth: 1600, maxHeight: 1600, quality: 0.82, mimeType: "image/jpeg" }
  },
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),
  autoFlush: true // flush when online
});

media.on("progress", ({ id, pct }) => console.log(id, pct));
media.on("complete", ({ id, url }) => console.log("done", id, url));
media.on("error", ({ id, error }) => console.warn(id, error));

// Instant enqueue (compress + persist), upload runs in background when online
const input = document.querySelector<HTMLInputElement>("#file")!;
input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;
  const job = await media.enqueue(file);
  showPreview(job.previewUrl);
});

await media.flush(); // optional manual flush
```

## How upload works

1. `enqueue(file)` optionally compresses images → stores **job + blob** in IndexedDB  
2. `flush()` (or auto on `online`) uploads **chunks** with:
   - `Content-Range: bytes start-end/total`
   - `X-Upload-Id`, `X-File-Name`, `X-Chunk-Start`, `X-Chunk-End`, `X-Total-Size`
3. After each successful chunk, `bytesUploaded` is saved → **resume-safe**  
4. On the final chunk, server should return JSON `{ "url": "https://..." }` (or a raw URL string)

## Server expectations (MVP)

Your `PUT endpoint` should:

- Accept chunk bodies  
- Key uploads by `X-Upload-Id`  
- Append/store bytes for the range  
- On the last chunk (`X-Chunk-End === X-Total-Size`), finalize and respond with `{ url }`

## API

| Method | Purpose |
| --- | --- |
| `enqueue(file)` | Compress (images), persist, return `MediaJob` |
| `flush()` | Upload pending jobs |
| `list()` | All jobs |
| `pause(id)` / `resume(id?)` | Pause one job or resume + flush |
| `remove(id)` | Delete job + blob |
| `on(event, fn)` | `enqueue` \| `progress` \| `complete` \| `error` \| `change` |

## With OfflineJS data layer

| Concern | Use |
| --- | --- |
| JSON records / checklists / stock | `createOfflineDB` |
| Photo / file uploads | `createMediaQueue` |
| TTL GET caching | `cachedJson` |

Typical inspection app: OfflineDB for the form fields, media-queue for site photos.
