# AUDIT — Pass 2: BullMQ Workers & Queue Infrastructure

Scope: `apps/api/src/workers/**`, `apps/api/src/lib/bullmq-connection.ts`, queue-creating libs
(`maya-memory-queue.ts`, `lead-score-queue.ts`, `scanner-pause.ts`), and producer call sites in
routes. Read-only audit; every file in scope was read in full. Connection-per-call pattern
(`createBullMQConnection()`) is correct per ground truth and is not flagged.

## Worker Inventory

All 26 workers are registered in `workers/index.ts` via `createXxxWorker()` factories and inherit
the global `SCANNERS_ENABLED` guard at `index.ts:40-43` (`if (process.env['SCANNERS_ENABLED'] === 'false') { ... return }`)
— no worker starts when it is `false`. No worker has an individual guard; none needs one, since
registration is the only entry point.

| #   | Worker                    | File                           | Queue                      | Registered         | SCANNERS_ENABLED | Idempotent                                                                                  | Tenant-Scoped                                                                                                       |
| --- | ------------------------- | ------------------------------ | -------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | lead-stalled-scanner      | lead-stalled-scanner.ts        | lead-stalled-scanner       | Yes (index.ts:51)  | via global guard | Partial — re-emits event hourly while lead stays stale; relies on downstream event_id dedup | Fleet scan by design; per-row queries carry tenant_id                                                               |
| 2   | no-show-scanner           | no-show-scanner.ts             | no-show-scanner            | Yes (index.ts:61)  | via global guard | Yes — status transition happens first                                                       | Fleet scan; update/contact reads PK-only (see P2-9)                                                                 |
| 3   | follow-up-missed-scanner  | follow-up-missed-scanner.ts    | follow-up-missed-scanner   | Yes (index.ts:67)  | via global guard | **No** — re-pushes hourly, no sent marker (P2-6)                                            | Fleet scan; step-3 checks PK-only                                                                                   |
| 4   | appointment-reminder      | appointment-reminder-worker.ts | appointment-reminder       | Yes (index.ts:77)  | via global guard | Partial — flag written after send (P2-2)                                                    | Fleet scan; contact fetch PK-only                                                                                   |
| 5   | follow-up-cadence         | follow-up-cadence-worker.ts    | follow-up-cadence          | Yes (index.ts:87)  | via global guard | Partial — step marker written after send (P2-3)                                             | Fleet scan; contact update PK-only                                                                                  |
| 6   | webhook-retry             | webhook-retry-worker.ts        | ops-copilot-retry          | Yes (index.ts:97)  | via global guard | Partial — bounded 3 attempts; new activity_event_id per attempt                             | Yes — tenant_id in payload                                                                                          |
| 7   | quote-expiry              | quote-expiry-worker.ts         | quote-expiry               | Yes (index.ts:102) | via global guard | Yes — status transition                                                                     | Fleet scan; update PK-only                                                                                          |
| 8   | data-retention            | data-retention-worker.ts       | data-retention             | Yes (index.ts:112) | via global guard | Yes — deletes are idempotent                                                                | Deliberately fleet-wide (uniform retention policy)                                                                  |
| 9   | quote-followup            | quote-followup-worker.ts       | quote-followup             | Yes (index.ts:122) | via global guard | Partial — viewed/status checks, no sent marker                                              | Yes (quote/tenant queries); quote fetch PK-only                                                                     |
| 10  | task-reminder             | task-reminder-worker.ts        | task-reminder              | Yes (index.ts:127) | via global guard | Partial — completed-check; push dups on redelivery                                          | Task fetch PK-only                                                                                                  |
| 11  | csv-import                | csv-import-worker.ts           | csv-import                 | Yes (index.ts:132) | via global guard | No — re-run re-imports (mitigated only if skip_duplicates)                                  | Yes — tenantId threaded to import-processor                                                                         |
| 12  | lead-score-compute        | lead-score-worker.ts           | lead-score-compute         | Yes (index.ts:137) | via global guard | Yes — derived recompute                                                                     | **Yes — exemplary** (tenant_id + id on every query)                                                                 |
| 13  | lead-score-bulk           | lead-score-worker.ts           | lead-score-bulk            | Yes (index.ts:146) | via global guard | Yes — re-enqueue harmless                                                                   | Yes                                                                                                                 |
| 14  | lead-score-decay          | lead-score-worker.ts           | lead-score-decay           | Yes (index.ts:155) | via global guard | Yes                                                                                         | Fleet scan; carries tenant_id per row                                                                               |
| 15  | review-request            | review-request-worker.ts       | review-request             | Yes (index.ts:169) | via global guard | Partial — dedup misses 'pending' (P1-6)                                                     | Mostly; contact fetch PK-only                                                                                       |
| 16  | data-export               | export-worker.ts               | data-export                | Yes (index.ts:174) | via global guard | Yes — upsert + status transitions                                                           | **Yes — exemplary** (every fetch `.eq('tenant_id', …)`)                                                             |
| 17  | low-stock-scanner         | low-stock-scanner.ts           | low-stock-scanner          | Yes (index.ts:179) | via global guard | Yes — 24h cooldown mark                                                                     | Yes — per-tenant loop, scoped update                                                                                |
| 18  | scheduled-report          | scheduled-report-worker.ts     | scheduled-reports          | Yes (index.ts:189) | via global guard | Partial — last_sent_at after send, error unchecked (P2-4)                                   | Yes; final update PK-only                                                                                           |
| 19  | scheduled-report-scanner  | scheduled-report-scanner.ts    | scheduled-report-scanner   | Yes (index.ts:194) | via global guard | Yes — isDue gate                                                                            | Fleet scan by design                                                                                                |
| 20  | weekly-digest             | weekly-digest-worker.ts        | weekly-digest              | Yes (index.ts:204) | via global guard | Partial — mark after send; 6-day window limits blast                                        | Fleet scan; per-tenant queries scoped                                                                               |
| 21  | invoice-overdue-scanner   | invoice-overdue-scanner.ts     | invoice-overdue-scanner    | Yes (index.ts:214) | via global guard | Yes — status transition                                                                     | Fleet scan; batch update PK-only                                                                                    |
| 22  | campaign-send (legacy)    | campaign-send-worker.ts        | **campaign-send (shared)** | Yes (index.ts:224) | via global guard | Partial — resends only 'pending' recipients                                                 | Yes on campaigns/contacts; recipient updates PK-only                                                                |
| 23  | outbound-call             | outbound-call-worker.ts        | outbound-calls             | Yes (index.ts:229) | via global guard | Partial — status check without claim (P2-8)                                                 | Yes — contact fetch carries tenant_id                                                                               |
| 24  | custom-automation-scanner | custom-automation-worker.ts    | custom-automation-scanner  | Yes (index.ts:234) | via global guard | **No** — repeats actions every 30 min (P1-5)                                                | Yes — all trigger/action queries scoped                                                                             |
| 25  | maya-memory-extractor     | maya-memory-extractor.ts       | voice-session-complete     | Yes (index.ts:244) | via global guard | Partial — call_count inflates on re-run; upsert keyed tenant_id,phone                       | Yes; session fetch PK-only                                                                                          |
| 26  | campaign-sender (P13)     | campaign-sender.ts             | **campaign-send (shared)** | Yes (index.ts:249) | via global guard | Partial — status guard protects redelivery, not operator resume (P2-1)                      | Yes — all scoped; campaign_sends has no tenant_id column by schema (RLS derives via campaigns join, migration 0115) |

Stubs (intentional, not registered): `follow-up-worker.ts:1` and `lead-worker.ts:1` — both read
`// STUB — intentionally empty. Logic moved to scanner. Do not register in index.ts.` Not flagged.

**Repeatable job configs (all jobIds stable — a redeploy does not stack duplicates):**

- lead-stalled: `{ repeat: { every: 3600000 }, jobId: 'lead-stalled-repeat' }` (index.ts:55)
- no-show: `{ repeat: { every: 300000 }, jobId: 'no-show-repeat' }` (index.ts:62)
- follow-up-missed: `{ repeat: { every: 3600000 }, jobId: 'follow-up-missed-repeat' }` (index.ts:71)
- appointment-reminder: `{ repeat: { every: 900000 }, jobId: 'appointment-reminder-repeat' }` (index.ts:81)
- follow-up-cadence: `{ repeat: { every: 3600000 }, jobId: 'follow-up-cadence-repeat' }` (index.ts:91)
- quote-expiry: `{ repeat: { every: 3600000 }, jobId: 'quote-expiry-repeat' }` (index.ts:106)
- data-retention: `{ repeat: { every: 7 * 86400000 }, jobId: 'data-retention-weekly' }` (index.ts:116)
- lead-score-decay: `{ repeat: { every: 86400000 }, jobId: 'lead-score-decay-repeat' }` (index.ts:159)
- low-stock: `{ repeat: { pattern: '0 8 * * *' }, jobId: 'low-stock-repeat' }` (index.ts:183)
- scheduled-report-scanner: `{ repeat: { every: 3600000 }, jobId: 'scheduled-report-scanner-repeat' }` (index.ts:198)
- weekly-digest: `{ repeat: { pattern: '0 8 * * 1' }, jobId: 'weekly-digest-repeat' }` (index.ts:208)
- invoice-overdue: `{ repeat: { pattern: '0 9 * * *' }, jobId: 'invoice-overdue-scanner-daily' }` (index.ts:218)
- custom-automation: `{ repeat: { every: 1800000 }, jobId: 'custom-automation-repeat' }` (index.ts:238)

**Connection lifecycle:** each factory creates one fresh ioredis connection shared by its Queue +
Worker (BullMQ duplicates internally for blocking ops — correct per ground truth). Graceful
shutdown (`stopWorkers`, index.ts:254-265) calls `worker.close()` (drains in-flight jobs) then
`queue.close()` per worker. The ioredis instances themselves are never quit — see P3-1. Route-side
ephemeral queues (`voice-outbound.ts:249`, `appointments.ts:596`, `automation-overview.ts` all
paths incl. catch at `:111`) are closed correctly. One leak path in a worker: P2-5.

## Findings

### [P1] Shared 'campaign-send' queue silently drops campaigns — mutual-exclusion guard is insufficient

File: apps/api/src/workers/campaign-sender.ts:111
Evidence:

```ts
if (!Array.isArray(campaign.channels) || campaign.channels.length === 0) {
  console.info(
    `[campaign-sender] campaign ${campaignId} has no P13 channels — skipping (legacy campaign)`
  )
  return
}
```

(inverse guard: campaign-send-worker.ts:66-71; both workers registered on the same queue at index.ts:224-226 and index.ts:249-251)
Impact: BullMQ delivers each job to exactly ONE of the two competing workers — when the wrong worker gets it, the early `return` marks the job **completed** without re-enqueueing, so the campaign is never processed by the right worker and sits in 'scheduled' forever (~coin-flip per send). The known dual-listener issue is logged, but this is the guard being insufficient: early-return is a drop, not a route.
Fix: split into two queue names (or one worker that dispatches on channels), or have the guard re-enqueue/delegate instead of returning.

### [P1] no-show-scanner sends rebook SMS via raw Telnyx fetch, bypassing the TCPA opt-in check in sendSms

File: apps/api/src/workers/no-show-scanner.ts:133
Evidence:

```ts
            const res = await fetch('https://api.telnyx.com/v2/messages', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ from: fromNumber, to: toPhone, text: smsText }),
```

Impact: `lib/sms.ts:33-41` runs `checkTcpaOptIn` before every send, but this worker calls Telnyx directly, so opted-out/never-opted-in contacts receive automated rebook SMS — a compliance exposure, not just a style issue.
Fix: route the send through `sendSms(fromNumber, toPhone, smsText, { contactId, tenantId })`.

### [P1] quote-followup worker also bypasses sendSms/TCPA with a raw Telnyx fetch

File: apps/api/src/workers/quote-followup-worker.ts:80
Evidence:

```ts
  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromNumber,
      to: contactPhone,
```

Impact: 48-hour quote follow-up SMS goes out with no `checkTcpaOptIn` gate; an opted-out contact still gets texted.
Fix: replace the raw fetch with `sendSms(...)` passing contactId + tenantId.

### [P1] Raw phone numbers and emails serialized into worker logs (same class as the Pass-1 tool-handlers finding)

File: apps/api/src/workers/appointment-reminder-worker.ts:78
Evidence:

```ts
console.info(
  `[appointment-reminder] sending 24h reminder: appointment=${appt.id} contact=${contact.phone} at=${appt.start_time}`
)
```

All sites found: appointment-reminder-worker.ts:78 and :106 (`contact=${contact.phone}`); no-show-scanner.ts:143 (`rebook SMS sent to=${toPhone}`); quote-followup-worker.ts:97 (`to=${contactPhone}`); weekly-digest-worker.ts:95, :106, :125 (`email=${ownerEmail}`); and on the worker send path lib/sms.ts:37 (`TCPA suppressed: ... to=${to}`). Contrast: maya-memory-extractor.ts:45 correctly uses `maskPhone(phone)`.
Impact: contact PII (phone numbers, owner emails) lands in plaintext application logs, the exact class removed from voice logs in commit 2a23bbe.
Fix: mask with the existing `maskPhone` helper (and elide/mask emails) at each cited site.

### [P1] custom-automation-scanner repeats actions every 30-minute scan — no per-contact run marker — and its send_sms/send_email actions are dead-ends

File: apps/api/src/workers/custom-automation-worker.ts:246
Evidence:

```ts
      case 'create_task': {
        const dueAt = new Date(now.getTime() + 86400000).toISOString()
        const { error } = await supabase.from('tasks').insert({
          tenant_id,
          contact_id,
          title: (action_config.title as string) ?? 'Follow up',
```

Impact: trigger queries (`getContactsForTrigger`, :45-188) have no "already actioned" filter and the scan repeats every 30 min (index.ts:238), so a contact matching `no_response`/`birthday`/`overdue_invoice` gets a NEW task (or a new `status:'queued'` sms_messages/email_messages row, :203-241) every scan — up to 48 duplicates per day per contact; additionally no dispatcher for `status='queued'` rows exists anywhere in apps/api/src (verified by grep — sms-webhooks.ts:206 is a Telnyx delivery-status map, sms-health.ts:61 excludes 'queued'), so the "sent" automations never actually deliver while polluting conversation threads.
Fix: record a per-(automation, contact) last-run marker (or unique constraint) checked by the trigger queries, and either wire a dispatcher for queued messages or send via sendSms/sendEmail directly.

### [P1] review-request dedup ignores 'pending' rows — redelivery after a mid-job crash double-sends the SMS

File: apps/api/src/workers/review-request-worker.ts:52
Evidence:

```ts
const { data: existing } = await supabase
  .from('review_requests')
  .select('id, status')
  .eq('tenant_id', tenantId)
  .eq('appointment_id', appointmentId)
  .in('status', ['sent', 'clicked'])
```

Impact: the worker inserts a 'pending' row (:84-93), sends the SMS (:153), then updates to 'sent' (:166-169); if the process dies between send and update, BullMQ stalled-job redelivery re-runs the job, the dedup check misses the 'pending' row, and a second review-request row + second SMS go out.
Fix: include 'pending' in the dedup status list (or add a unique constraint on tenant_id+appointment_id).

### [P2] campaign-sender (P13) resume path re-sends to every contact — no campaign_sends dedup on re-run

File: apps/api/src/workers/campaign-sender.ts:264
Evidence:

```ts
        const { data: sendRow } = await supabase
          .from('campaign_sends')
          .insert({
            campaign_id: campaignId,
            contact_id: contact.id,
            channel,
            status: 'sent',
```

Impact: the `status !== 'scheduled'` guard (:118-123) protects against BullMQ redelivery, but a crash mid-fan-out sets status='paused' (:343-348); when an operator resets it to 'scheduled' to retry, the loop has no check for existing campaign_sends rows and no unique constraint (migration 0115), so contacts already messaged get the campaign again.
Fix: skip contacts that already have a campaign_sends row for this campaign+channel (or add a unique constraint and upsert).

### [P2] appointment-reminder marks the sent flag AFTER the SMS — failed mark = duplicate reminder next 15-min scan

File: apps/api/src/workers/appointment-reminder-worker.ts:82
Evidence:

```ts
      const { success: sent } = await sendSms(location.telnyx_number, contact.phone, text, {
        contactId: appt.contact_id,
        tenantId: appt.tenant_id,
      })

      if (sent) {
        await supabase.from('appointments').update({ reminder_24h_sent: true }).eq('id', appt.id)
```

Impact: if the update fails or the process dies between send and mark, the appointment still matches `reminder_24h_sent = false` on the next scan (every 15 min inside a 2-hour window) and the customer is texted again; same shape at :110-116 for the 1h flag.
Fix: claim the row first (set the flag, or a 'sending' marker, before the send) or make the mark failure re-checked before resend.

### [P2] follow-up-cadence advances the step marker AFTER the send — same duplicate-send-on-failed-mark shape

File: apps/api/src/workers/follow-up-cadence-worker.ts:139
Evidence:

```ts
await supabase
  .from('contacts')
  .update({
    follow_up_step: step + 1,
    follow_up_last_sent: new Date().toISOString(),
  })
  .eq('id', contact.id)
```

Impact: SMS/email is sent (:113-131) before this update; if the update fails, the hourly scan re-sends the same cadence step to the same contact.
Fix: same as above — persist the step claim before (or transactionally with) the send.

### [P2] scheduled-report: last_sent_at written after send with error ignored — a failed write means up to 23 more duplicate report emails that day

File: apps/api/src/workers/scheduled-report-worker.ts:397
Evidence:

```ts
// Update last_sent_at
await supabase
  .from('scheduled_reports')
  .update({ last_sent_at: new Date().toISOString() })
  .eq('id', scheduledReportId)
```

Impact: the scanner's `isDue` (scheduled-report-scanner.ts:32-44) gates only on day-match + `last_sent_at`, and it scans hourly; if this unchecked update fails, the report stays "due" for the rest of the day and every hourly scan enqueues and emails it again to all recipients.
Fix: check the update error (retry/alert), or set last_sent_at when enqueueing rather than after sending.

### [P2] scheduled-report-scanner leaks a Redis connection when enqueueing throws — close() is not in a finally

File: apps/api/src/workers/scheduled-report-scanner.ts:71
Evidence:

```ts
  const reportQueue = new Queue(REPORT_QUEUE, {
    connection: createBullMQConnection(),
    skipVersionCheck: true,
  })
  ...
    await reportQueue.add('send', payload)
  ...
  await reportQueue.close()
```

Impact: a throw from `reportQueue.add` (:84) propagates out of `scanScheduledReports` and skips `reportQueue.close()` (:90), leaking one Redis connection per failed hourly scan — on Azure Cache for Redis (connection-capped) this accumulates until restart.
Fix: wrap the enqueue loop in try/finally with close() in the finally.

### [P2] follow-up-missed-scanner re-sends the push notification every hourly scan for the same contact — no sent marker

File: apps/api/src/workers/follow-up-missed-scanner.ts:147
Evidence:

```ts
void sendPushNotification(m.tenant_id, {
  title: 'Follow-up Needed',
  body: `${m.full_name} hasn't been contacted in ${Math.floor(hoursSince / 24)} days`,
  url: '/automation',
})
```

Impact: a contact stays inside the 2-7-day window for ~5 days and nothing records that a push was already sent, so the tenant owner gets this notification up to ~120 times per missed contact (the activity event at :133 at least has a constant event_id for downstream dedup; the push has nothing).
Fix: record a per-contact notified-at marker (or reuse the activity event_id dedup) before pushing.

### [P2] quote-followup and task-reminder jobs use removeOnFail: true — a failed one-shot job is deleted with no retry and no dead-letter

File: apps/api/src/routes/quotes.ts:636
Evidence:

```ts
          {
            delay: 48 * 60 * 60 * 1000, // 48 hours
            removeOnComplete: true,
            removeOnFail: true,
          }
```

(same at task-reminder-worker.ts:84-88: `{ delay, removeOnComplete: true, removeOnFail: true }`)
Impact: with default attempts=1, any throw (e.g. quote-followup-worker.ts:93 throws on Telnyx failure) fails the job once and BullMQ then deletes it — the follow-up/reminder is gone, invisible to the automation-overview failed-jobs dashboard and to retry-failed.
Fix: drop removeOnFail (or set bounded attempts with backoff) so failures land in the failed set the ops dashboard already surfaces.

### [P2] outbound-call worker checks status='pending' but never claims the row before dialing — stalled redelivery can double-dial

File: apps/api/src/workers/outbound-call-worker.ts:69
Evidence:

```ts
// Step 2: Check status still pending
if (typedJob.status !== 'pending') {
  console.info(`[outbound-call] job ${jobId} status=${typedJob.status} — skipping`)
  return
}
```

Impact: nothing between this check and `initiateOutboundCall` (:155) writes a 'dialing'/claimed status to outbound_call_jobs, so if the worker stalls after initiating and BullMQ redelivers, the status is still 'pending' and the contact gets a second AI call; the producer-side `jobId: job.id` dedup (outbound-calls.ts:111) prevents double-enqueue but not redelivery.
Fix: atomically update status pending→dialing (conditional update, checking affected rows) before initiating.

### [P2] Consolidated: worker DB writes/reads keyed by PK only, omitting tenant_id — violates the stated defense-in-depth invariant under a service-role client

File: apps/api/src/workers/no-show-scanner.ts:56
Evidence:

```ts
const { error: updateErr } = await supabase
  .from('appointments')
  .update({ status: 'no_show' })
  .eq('id', appt.id)
```

All sites (each id comes from a tenant-scoped read in the same function, so none is exploitable today, but none carries the required tenant_id belt-and-suspenders): no-show-scanner.ts:56-59 (update) and :71-75, :114-118 (contact reads); appointment-reminder-worker.ts:88, :116 (updates), :133 (contact read); follow-up-cadence-worker.ts:139-145 (update); follow-up-missed-scanner.ts:92-98, :103-109, :114-118 (reads); invoice-overdue-scanner.ts:50-53 (batch update); quote-expiry-worker.ts:39 (update); quote-followup-worker.ts:41-44, :52 (reads); task-reminder-worker.ts:39-43 (read); csv-import-worker.ts:39-42, :52-56, :60-70, :83-86 (import_jobs updates); export-worker.ts:148-151, :195-205, :219-226 (export_jobs updates); maya-memory-extractor.ts:51-55 (session read); scheduled-report-worker.ts:397-400 (update); campaign-send-worker.ts:142-146 (read), :191-239 (recipient updates); review-request-worker.ts:66-70 (contact read).
Impact: the service-role client bypasses RLS, so any future code path that feeds an id from job data (rather than a scoped read) into these writes becomes a cross-tenant write with no backstop; today it is a latent-risk pattern, not an active leak.
Fix: add `.eq('tenant_id', …)` to each listed query (mechanical; tenant_id is already in scope at every site).

### [P3] stopWorkers never quits the ioredis connections the factories created

File: apps/api/src/workers/index.ts:254
Evidence:

```ts
export async function stopWorkers(): Promise<void> {
  for (const { name, worker, queue } of managed) {
    try {
      await worker.close()
      await queue.close()
```

Impact: BullMQ does not close externally-provided ioredis instances on worker/queue close, and the lazy lib singletons (getFollowupQueue, getTaskReminderQueue, getCsvImportQueue, getExportQueue, getRetryQueue, lead-score-queue, maya-memory-queue) are never closed at all — harmless when the process exits after shutdown, but it keeps the event loop alive in embedded contexts (matches the Jest "worker process failed to exit gracefully" warning).
Fix: retain each factory's connection and `await connection.quit()` in stopWorkers (and add a close hook for the lib singletons).

### [P3] Scanner-pause support is inconsistent — quote-expiry, low-stock, weekly-digest, and data-retention ignore scanner_pauses

File: apps/api/src/workers/quote-expiry-worker.ts:15
Evidence:

```ts
export async function scan(): Promise<void> {
  console.info('[quote-expiry] scanning for expired quotes...')

  try {
    const supabase = getSupabase()
    const now = new Date().toISOString()
```

Impact: other scanners honor per-tenant pauses via getPausedTenants/isScannerPaused; these four run regardless, so a tenant who pauses automations still gets quotes expired, low-stock alerts, and digests (data-retention arguably should stay global).
Fix: add the same getPausedTenants filter used by the sibling scanners where per-tenant pause makes sense.

### [P3] scheduled-report sendEmail omits the tenantId option every other caller passes

File: apps/api/src/workers/scheduled-report-worker.ts:388
Evidence:

```ts
const ok = await sendEmail({ to: email, subject, html: result.html })
```

Impact: whatever per-tenant handling sendEmail does with tenantId (weekly-digest-worker.ts:92 and campaign-sender.ts:299-304 both pass it) is skipped for scheduled reports.
Fix: pass `tenantId` in the options object.

### [P3] Legacy campaign worker reverts a partially-sent campaign to 'draft' on error

File: apps/api/src/workers/campaign-send-worker.ts:267
Evidence:

```ts
  } catch (err) {
    // Revert status to 'draft' so it can be retried
    await supabase
      .from('campaigns')
      .update({ status: 'draft' })
```

Impact: a crash mid-batch leaves potentially hundreds of recipients in status 'sent' while the campaign reads 'draft' — misleading UI state; actual re-send is safely limited to 'pending' recipients (:142-146), so this is cosmetic/operational, not a double-send.
Fix: use a distinct 'partial'/'failed' status instead of 'draft'.

## Orphan Queues / Unregistered Workers

- **Unregistered worker files:** none beyond the two intentional stubs (`follow-up-worker.ts`, `lead-worker.ts`, both `export {}` with a "do not register" comment).
- **Produced but never consumed:** none found. Every producer maps to a registered consumer: campaigns.ts:742/:823/:930 → 'campaign-send' (two consumers — see P1-1); outbound-calls.ts:111 + voice-outbound.ts:248 → 'outbound-calls'; appointments.ts:587 → 'review-request'; quotes.ts:625 → 'quote-followup'; tasks.ts (enqueueTaskReminder) → 'task-reminder'; import.ts → 'csv-import'; data-export.ts → 'data-export'; lead-scoring.ts:181 → 'lead-score-bulk'; lead-score-queue.ts → 'lead-score-compute'; ops-copilot-client.ts (enqueueRetry) → 'ops-copilot-retry'; call-session-logger.ts (maya-memory-queue) → 'voice-session-complete'; scheduled-report-scanner.ts:84 → 'scheduled-reports'; all repeatable scanner queues self-produce via index.ts.
- **Consumed but never produced:** none — scanner queues are fed by their repeatable jobs; on-demand queues all have the route/lib producers above.

## Summary Counts

| Severity  | Count  |
| --------- | ------ |
| P0        | 0      |
| P1        | 6      |
| P2        | 9      |
| P3        | 4      |
| **Total** | **19** |

P1: campaign-send shared-queue job drop (guard insufficient); no-show TCPA bypass; quote-followup TCPA bypass; PII in worker logs; custom-automation duplicate actions + dead-end queued messages; review-request double-SMS window.
P2: P13 resume re-send; appointment-reminder send-then-mark; follow-up-cadence send-then-mark; scheduled-report duplicate-day emails; scanner connection leak; follow-up-missed push spam; removeOnFail silent loss; outbound-call claim gap; PK-only tenant-scoping invariant (consolidated).
P3: unclosed ioredis on shutdown; inconsistent scanner-pause coverage; sendEmail tenantId omission; legacy 'draft' revert on partial send.
