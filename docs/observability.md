# Operational observability

Qualyra exposes a Prometheus-compatible endpoint at `GET /metrics`. It is outside the tenant API because it contains only aggregate operational signals, never tenant identifiers, recipient addresses, tokens, request URLs, query values, or payloads.

The endpoint always requires `Authorization: Bearer <METRICS_BEARER_TOKEN>`. It can be disabled with `METRICS_ENABLED=false`; production validation rejects the committed local token and tokens shorter than 32 characters. Give the scraper the token through the deployment secret manager and restrict the route at the network layer as defense in depth.

Local verification:

```bash
curl -H "Authorization: Bearer qualyra_local_metrics_token" http://localhost:3000/metrics
```

## Metric contract

- `qualyra_http_requests_total` and `qualyra_http_request_duration_seconds` use HTTP method, stable controller/handler name, and status code. They never label raw paths, IDs, tenants, or query strings.
- `qualyra_outbox_messages` reports aggregate counts by state across active tenants. Collection enters each tenant RLS context and exposes no tenant label.
- `qualyra_outbox_delivery_attempts_total`, `qualyra_outbox_delivery_duration_seconds`, `qualyra_outbox_lease_recoveries_total`, and worker run/last-success metrics describe durable delivery behavior.
- `qualyra_dependency_ready` reports the Redis probe used by metric collection. `qualyra_metrics_collection_success` makes stale or failed dynamic collection visible instead of silently reporting false zeros.
- `qualyra_node_*` contains standard process metrics from the Node.js runtime.

The versioned starter rules are in `ops/prometheus/qualyra-alerts.yml`. Import them into the selected Prometheus-compatible platform, tune thresholds from staging load data, attach owned runbooks and notification routes, then fire and acknowledge every alert before launch. The repository does not deploy a monitoring platform or an on-call process.

## Distributed request limiting

Nest request and credential throttles use an atomic Redis fixed window shared by every API instance. The limiter fails closed: if Redis is unavailable or returns malformed data, protected application requests are not allowed through. `/health/live`, `/health/ready`, and `/metrics` skip the guard so the platform can still diagnose the process; readiness reports Redis as down and must remove the instance from service.

Use a dedicated Redis identity and keyspace, private networking, authentication, encryption in transit (`rediss://` is required by production validation), memory/eviction alerts, and high availability appropriate to the launch risk. Keep edge rate limiting as an independent outer control.
