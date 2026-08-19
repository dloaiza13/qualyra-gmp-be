# Durable notification delivery

Phase 22 routes authentication, invitation, and CAPA email through the tenant-scoped transactional outbox. The business change and its outbox row commit in the same PostgreSQL transaction. SMTP is invoked only after that transaction has closed.

The worker claims a bounded batch with an optimistic lease, commits the claim, and then performs external delivery. Competing instances can read the same candidate, but the conditional status/attempt update allows only one to claim it. An expired lease becomes retryable or dead-lettered according to the configured attempt limit. Failures use bounded exponential backoff.

Delivery semantics are **at least once**. A process can fail after SMTP accepts a message and before PostgreSQL records success. A stable `Message-ID` is supplied on every retry to help a provider recognize duplicates, but SMTP does not provide a portable exactly-once guarantee.

## Secret handling

One-time token tables retain only SHA-256 digests. A pending email must nevertheless contain the usable token, so the outbox stores the entire payload under AES-256-GCM with tenant, type, and deduplication key bound as authenticated data. Successful or domain-cancelled messages replace the ciphertext with a non-sensitive tombstone. Dead-letter payloads remain encrypted only so an authorized operator can retry them.

`OUTBOX_PAYLOAD_ENCRYPTION_KEY` must be a dedicated 32-byte hexadecimal secret. Production validation rejects the development placeholder. Rotation requires draining or deliberately disposing all pending and dead-letter messages before replacing the key; a key-ring migration is required for rotation without a drain.

## Operations

The worker is controlled by `OUTBOX_WORKER_ENABLED`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_LOCK_TIMEOUT_MINUTES`, `OUTBOX_RETRY_BASE_SECONDS`, and `OUTBOX_RETRY_MAX_SECONDS`.

Users with `notifications.read` can inspect delivery type, state, attempt counts, safe error code, and timestamps for their own tenant. Recipient addresses, tokens, and payloads are never returned. `notifications.retry` permits recovery of dead-letter rows and appends `NOTIFICATION_DELIVERY_RETRIED` to the security-event trail. Standard Administrators and QA Managers can read and retry; Auditors have read-only access.

The authenticated Prometheus endpoint exports dead-letter count, retry outcomes, lease recovery, delivery latency, and worker liveness. Versioned starter alerts are provided under `ops/prometheus`; they still require deployment, threshold tuning, owned routing, and an alert exercise. Provider-level delivery, bounce, complaint, and suppression feedback remains outside the current SMTP contract.
