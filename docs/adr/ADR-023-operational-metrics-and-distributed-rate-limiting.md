# ADR-023: Operational metrics and distributed rate limiting

## Status

Accepted on 2026-08-18.

## Context

Process-local request counters diverge as soon as the API scales horizontally. The durable notification worker also needs measurable delivery, retry, lease-recovery, dead-letter, and liveness signals. Raw tenant or URL labels would create sensitive, unbounded metric cardinality.

## Decision

- Store request-throttle state in Redis through one atomic Lua operation and use the same generated route/tracker key on every API instance.
- Fail protected requests closed when Redis cannot enforce the limit, while exempting diagnostic health and metric endpoints and marking readiness down.
- Export Prometheus-compatible process, stable-route HTTP, dependency, and aggregate outbox metrics behind a dedicated bearer token.
- Aggregate outbox state by entering each active tenant's RLS context, without tenant labels.
- Version provider-neutral starter alert rules for API errors/latency, Redis degradation, metric collection failure, dead letters, worker staleness, retries, and lease recovery.

## Consequences

Horizontal API instances enforce a common abuse budget and operators can detect delivery degradation without exposing tenant data. Redis becomes a critical serving dependency. Metric scraping performs bounded tenant-aware aggregate queries, so production must measure and tune scrape frequency and database cost. The deployment remains responsible for the Redis topology, Prometheus-compatible collector, secret delivery, alert routing, runbooks, dashboards, retention, and on-call ownership.
