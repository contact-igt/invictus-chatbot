# Campaign Workflow (End-to-End)

## Scope

This workflow describes how a campaign moves from creation to recipient-level completion in the current queue-first execution model.

## 1) Campaign Creation

1. User creates campaign via campaign API route.
2. System validates:

- tenant access
- WhatsApp token/config presence
- template approval state
- audience payload
- billing access estimate (create-time guard)

3. Campaign row is created.
4. Recipient rows are created with status `pending`.
5. Campaign status is set:

- `scheduled` for scheduled campaigns
- `active` for immediate campaigns

## 2) Scheduling and Triggering

There are three trigger paths:

- Scheduled path
  - Scheduler activates due campaigns and queues dispatch jobs.
- Manual trigger path
  - Execute endpoint queues a dispatch job immediately.
- Safety fallback path
  - If queue is unavailable, service executes sync batch processing.

## 3) Dispatch Stage

For each dispatch job:

1. Dispatch worker acquires distributed lock per campaign.
2. Reads one page of pending recipients.
3. Reserves billing for page size (except perf bypass).
4. Enqueues send jobs in bulk into tenant queue.
5. If page size is full, dispatch worker queues next page with new cursor.
6. Reservation is confirmed/released based on actual enqueued count.

## 4) Send Stage

For each send job:

1. Send worker loads campaign/template/recipient context.
2. Validates phone and template-variable consistency.
3. Builds Meta template payload.
4. Sends request in fire-and-forget mode.
5. Immediately buffers recipient update as `sent` (message id nullable).
6. Batch flusher writes recipient/message rows to DB.

## 5) Retry, Failure, and DLQ

- Permanent errors
  - marked `permanently_failed` immediately.
- Retryable errors
  - thrown for BullMQ retry with backoff.
- Exhausted jobs
  - moved to tenant DLQ queue.
  - recipient forced to `permanently_failed`.

## 6) Webhook Reconciliation

1. Meta posts status updates to webhook.
2. Webhook resolves tenant and message mapping.
3. Recipient status progresses (`delivered`, `read`, `failed`, etc.).
4. Campaign counters and completion outcomes are updated.
5. Socket events are emitted to tenant room.

## 7) Completion Logic

Campaign is considered done when no outstanding recipients remain.
Possible terminal outcomes:

- `completed` (at least one success or all flow ended)
- `failed` (terminal failure conditions)
- `cancelled` (manual)

## 8) Performance Test Workflow

Performance script executes synthetic campaigns by:

1. Initializing campaign queue connection.
2. Creating tenant/template/campaign/recipient fixtures.
3. Enqueueing dispatch job.
4. Waiting for terminal events / status counts.
5. Collecting throughput and duration metrics.
6. Cleaning up fixture records.

## 9) Key Operational Checks

Before running load tests:

- Redis connected and queue available.
- Dispatch worker running.
- Send worker running and attached to tenant queues.
- Billing bypass configured for `perf_` campaigns in dispatch worker.
- Webhook endpoint reachable for status reconciliation.

## 10) Quick Triage Matrix

- Dispatch queue empty + due campaigns exist
  - Scheduler path issue.
- Dispatch queue growing + no active dispatch worker
  - Dispatch worker down.
- Tenant queues growing + no send workers
  - Send worker not attached for tenant.
- Many sent with no delivered/read progression
  - Webhook ingestion/mapping issue.
- Frequent reservation errors in test campaigns
  - Verify perf-campaign billing bypass condition.
