# `@offlinejs/media-queue`

Durable offline media uploads for the web (images MVP).

```bash
pnpm add @offlinejs/media-queue
# or: pnpm add @offlinejs/client
```

```ts
import { createMediaQueue } from "@offlinejs/media-queue";

const media = createMediaQueue({
  endpoint: "/api/uploads",
  chunkSize: "auto",
  concurrency: 3,
  compress: { images: { maxWidth: 1600 } }
});

await media.enqueue(file);
```

## Shipped

- IndexedDB durable queue (jobs + blobs)
- On-device **image** compress / resize
- Chunked resume (`Content-Range` + `X-Upload-*`)
- Parallel jobs, progress / complete / error events
- Survives refresh, offline, flaky networks (resume on next open)

## Not shipped yet

- Browser **video** compression
- **tus** or **S3 multipart** adapters (custom chunk protocol only)
- **iOS Safari background** uploads (foreground / next-open resume only)
- **Storage quota** probing, eviction, OPFS spillover

Docs: https://offline-js-next2.vercel.app/media-queue
