# Best Practices

- Use IndexedDB or another durable adapter for browser production apps.
- Keep collection payloads serializable.
- Prefer small paginated reads for large datasets.
- Use server delta endpoints for efficient reconnects.
- Pick explicit conflict strategies per product workflow.
- Subscribe at page or feature boundaries, not every small component.
- Keep plugins focused and side-effect aware.
- Surface `error` events to observability in production.
