# API Route Contracts

All routes are mounted under:
- **`/api/whatsapp`** — primary prefix for all feature routes
- **`/api/v1`** — backward-compatible alias (templates, campaigns, media)

Authentication: `Authorization: Bearer <jwt>` header required on all protected routes.
Response envelope (success): `{ success: true, data: ... }`
Response envelope (error): `{ success: false, error_code: "SNAKE_CASE_CODE", message: "Human-readable message" }`

---

## Templates — `/api/whatsapp` (alias `/api/v1/templates`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/whatsapp-template` | ✅ tenant | `{ template_name, category, template_type, language, components, variables }` | `{ success, data: { template_id, status: "draft", ... } }` |
| GET | `/whatsapp-template` | ✅ tenant | — | `{ success, data: [Template] }` |
| GET | `/whatsapp-template/deleted` | ✅ tenant | — | `{ success, data: [Template] }` |
| GET | `/whatsapp-template/:template_id` | ✅ tenant | — | `{ success, data: Template }` |
| PATCH | `/whatsapp-template/:template_id` | ✅ tenant | `{ components?, variables?, category?, language? }` | `{ success, data: Template }` — sets `status="draft"` if was `approved` |
| POST | `/whatsapp-template/:template_id/submit` | ✅ tenant | — | `{ success, meta_template_id, meta_status }` |
| POST | `/whatsapp-template/:template_id/resubmit` | ✅ tenant | — | `{ success, meta_template_id }` |
| POST | `/whatsapp-template/:template_id/sync` | ✅ tenant | — | `{ success, status }` |
| POST | `/whatsapp-template/sync-all` | ✅ tenant | — | `{ success, synced_count }` |
| DELETE | `/whatsapp-template/:template_id/soft` | ✅ tenant | — | `{ success, message }` |
| DELETE | `/whatsapp-template/:template_id/permanent` | ✅ tenant_admin | — | `{ success, message }` |
| POST | `/whatsapp-template/:template_id/restore` | ✅ tenant_admin | — | `{ success, data: Template }` |
| POST | `/whatsapp-template/webhook` | ❌ public | Meta webhook payload | `200 OK` |

**Notes:**
- `PATCH` on an `approved` template automatically resets `status` to `"draft"` and requires resubmission to Meta.
- `updated_by` is always set to `req.user` — never trusted from request body.

---

## Campaigns — `/api/whatsapp` (alias `/api/v1/campaigns`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/whatsapp-campaign` | ✅ tenant | `{ campaign_name, campaign_type, template_id, audience_type, audience_data, scheduled_at? }` | `{ success, data: Campaign }` |
| GET | `/whatsapp-campaign` | ✅ tenant | Query: `?status&search&page&limit` | `{ success, data: { campaigns, totalItems, totalPages, currentPage } }` |
| GET | `/whatsapp-campaign/list` | ✅ tenant | Query: `?status&search&page&limit` | same as above |
| GET | `/whatsapp-campaign/deleted/list` | ✅ tenant | — | `{ success, data: { campaigns } }` |
| GET | `/whatsapp-campaign/:campaign_id` | ✅ tenant | Query: `?recipient_status` | `{ success, data: Campaign }` |
| GET | `/whatsapp-campaign/:campaign_id/stats` | ✅ tenant | — | `{ success, stats: { total_sent, total_delivered, total_opened, total_clicked, open_rate, click_rate } }` |
| POST | `/whatsapp-campaign/:campaign_id/execute` | ✅ tenant | — | `{ success, message }` |
| PATCH | `/whatsapp-campaign/:campaign_id/status` | ✅ tenant | `{ status }` | `{ success, data: Campaign }` |
| POST | `/whatsapp-campaign/estimate-cost` | ✅ tenant | `{ template_id, recipient_count }` | `{ success, total_cost_inr, is_sufficient, ... }` |
| POST | `/whatsapp-campaign/upload-media` | ✅ tenant | multipart: `media` (file) | `{ success, data: { url, media_handle } }` |
| DELETE | `/whatsapp-campaign/:campaign_id/soft` | ✅ tenant | — | `{ success, message }` |
| DELETE | `/whatsapp-campaign/:campaign_id/permanent` | ✅ tenant_admin | — | `{ success, message }` |
| POST | `/whatsapp-campaign/:campaign_id/restore` | ✅ tenant_admin | — | `{ success, data: Campaign }` |
| POST | `/whatsapp-campaign/event` | ❌ public | `{ campaign_id, recipient_id, event_type: "open"|"click" }` | `200 OK` |

**Status Transition Rules (`PATCH /status`):**
- `draft → scheduled` ✅
- `scheduled → active/running` ✅
- `active → paused` ✅
- `paused → active/running` ✅
- `active → completed` ✅
- `any → cancelled` ✅
- All other transitions → **422 Unprocessable Entity**

**Scheduler Notes:**
- All `scheduled_at` values stored in UTC. Scheduler compares using `UTC_TIMESTAMP()`.
- Failed recipients are retried after 5 min / 15 min / 45 min (exponential backoff). After 3 failures: `permanently_failed`.

---

## Media Gallery — `/api/whatsapp` (alias `/api/v1/media`)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/gallery/upload` | ✅ tenant | multipart: `file`, fields: `tags?`, `folder?` | `{ success, data: MediaAsset }` |
| GET | `/gallery` | ✅ tenant | Query: `?type&search&tags&folder&approved_only&pending_only&page&limit` | `{ success, total, page, limit, totalPages, data: [MediaAsset] }` |
| GET | `/gallery/:asset_id` | ✅ tenant | — | `{ success, data: MediaAsset }` |
| DELETE | `/gallery/:asset_id` | ✅ tenant | — | `{ success, message }` — 403 if asset is `approved` |
| PATCH | `/gallery/:asset_id/tags` | ✅ tenant | `{ tags: string[] }` | `{ success, data: MediaAsset }` |
| POST | `/gallery/:asset_id/restore` | ✅ tenant | — | `{ success, asset_id, file_name, message }` |

**Delete Behaviour:**
- Soft-deletes the DB record (`is_deleted = true`, `deleted_at = now`).
- If `HARD_DELETE_STORAGE=true` in `.env`, also purges the file from R2/S3 storage.
- Returns `403 Forbidden` if the asset has `is_approved = true`.

---

## Error Code Reference

| HTTP Status | `error_code` | Meaning |
|-------------|-------------|---------|
| 400 | `MISSING_FIELD` | Required field absent or malformed |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Valid token but insufficient permission |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `DUPLICATE_NAME` | Resource with that name already exists |
| 422 | `INVALID_STATUS_TRANSITION` | Status change not permitted |
| 422 | `VALIDATION_ERROR` | Business rule violated |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

---

## Environment Variables Required

| Variable | Used By | Description |
|----------|---------|-------------|
| `JWT_SECRET` | Auth | Signing secret for JWTs |
| `META_APP_ID` | Templates, Gallery | Meta application ID (fallback if not set per WABA) |
| `HARD_DELETE_STORAGE` | Gallery | `true` = also delete from R2/S3 on soft delete |
| `NODE_ENV` | Logger | `production` suppresses debug/error logs |
| `TEST_ADMIN_EMAIL` | Integration tests | Login for test suite |
| `TEST_ADMIN_PASSWORD` | Integration tests | Password for test suite |
