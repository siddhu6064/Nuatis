# Manual Smoke Tests — Pre-Deployment Checklist

Browser-based tests Sid runs locally before Azure deploy. Run after the 40 pending migrations are applied AND seeds have been run AND web stack works.

## Prerequisites

- [ ] Migrations 0003-0042 applied (see `MIGRATIONS_TO_APPLY.md`)
- [ ] All required env vars set (see `PENDING_ENV_VARS.md`)
- [ ] API running on `localhost:3001` (`cd apps/api && npm run dev`)
- [ ] Web running on `localhost:3000` (`cd apps/web && npm run dev`)
- [ ] Logged in as `sid@nuatis.com` to internal tenant `c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b`

## Tests

### 1. Auth + Onboarding

| #   | Action                        | Expected                                            | Verify                                                 |
| --- | ----------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| 1.1 | Navigate to `/sign-in`        | Email/password form renders                         | No 500 in browser console                              |
| 1.2 | Sign in with `sid@nuatis.com` | Redirects to `/dashboard`                           | Session cookie set, NextAuth in DevTools → Application |
| 1.3 | Navigate to `/onboarding`     | Either redirects (already complete) or shows wizard | `tenants.onboarding_completed` reflects state          |

### 2. Contacts

| #   | Action                                             | Expected                              | Verify                                                  |
| --- | -------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| 2.1 | Navigate to `/contacts`                            | List renders, shows existing contacts | Network tab: `GET /api/contacts` returns 200 with array |
| 2.2 | Click "New Contact" → fill name/email/phone → Save | Contact appears at top of list        | DB row in `contacts` table                              |
| 2.3 | Click contact row → Edit phone → Save              | New phone reflects on detail page     | Optimistic UI then refresh — should match               |
| 2.4 | Open contact detail → Notes tab → add note → save  | Note appears                          | `activity_log` row created                              |

### 3. Appointments

| #   | Action                                                       | Expected                        | Verify                                                              |
| --- | ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| 3.1 | Navigate to `/appointments`                                  | Calendar/list view renders      | No errors                                                           |
| 3.2 | Click empty slot → Schedule appointment for the test contact | Appointment appears in calendar | Row in `appointments`                                               |
| 3.3 | Open appointment → mark "Completed"                          | Status changes                  | If review automation enabled, BullMQ schedules `review-request` job |

### 4. Pipelines / Deals (Phase 10 multi-pipeline)

| #   | Action                                                             | Expected                         | Verify                                        |
| --- | ------------------------------------------------------------------ | -------------------------------- | --------------------------------------------- |
| 4.1 | Navigate to `/pipeline`                                            | Default pipeline kanban renders  | Stages from seed                              |
| 4.2 | Click pipeline switcher dropdown                                   | Lists all pipelines              | If only one, switcher hidden                  |
| 4.3 | Drag deal card from "Qualified" → "Won"                            | Card moves; stage updated        | `deals.stage_id` updated, `activity_log` row  |
| 4.4 | Settings → Pipelines → New Pipeline → "Sales" with 3 stages → Save | New pipeline appears in switcher | Row in `pipelines`, rows in `pipeline_stages` |

### 5. Quotes / CPQ

| #   | Action                                          | Expected                                 | Verify                                  |
| --- | ----------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| 5.1 | Open contact → Quotes tab → "New Quote"         | Builder opens with services autocomplete | Services list from `services` table     |
| 5.2 | Add 2 line items, set discount 10%, deposit 50% | Totals compute correctly                 | Approval state if discount > config max |
| 5.3 | Send quote → public URL → open in incognito     | Quote view page renders, "Accept" button | `quote_views` row recorded              |

### 6. Email integration (Phase 10 wk 67-68) — REQUIRES OAuth setup

| #   | Action                                                                             | Expected                     | Verify                                                       |
| --- | ---------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ |
| 6.1 | Settings → Integrations → "Connect Gmail"                                          | Google OAuth flow opens      | Returns to app after auth                                    |
| 6.2 | Open contact → Email tab → "Compose" → write subject/body → Send                   | Sent email appears in thread | Sent via `email-integrations` route, row in `email_messages` |
| 6.3 | Settings → Integrations → "Connect Outlook"                                        | Microsoft OAuth flow opens   | Returns to app                                               |
| 6.4 | Settings → Email Templates → New template with `{{first_name}}` placeholder → Save | Template stored              | `email_templates` row                                        |

### 7. Booking page (Phase 10 wk 67-68)

| #   | Action                                             | Expected                            | Verify                                        |
| --- | -------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| 7.1 | Settings → Booking → enable, set slug `test`, save | Booking page enabled                | `tenants.booking_page_enabled = true`         |
| 7.2 | Open `localhost:3000/book/test` in incognito       | Public booking page renders branded | No auth required                              |
| 7.3 | Pick service + slot → fill name/email → Submit     | Confirmation shown                  | Row in `appointments`, contact created if new |

### 8. Intake forms (Phase 10 wk 69-70)

| #   | Action                                                         | Expected               | Verify                                          |
| --- | -------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| 8.1 | Settings → Intake Forms → enable seeded form                   | Form active            | `intake_forms.is_active`                        |
| 8.2 | Open public form URL in incognito → fill all fields → Submit   | Confirmation shown     | Row in `intake_submissions` and contact created |
| 8.3 | Back in CRM, contact appears with intake data in custom fields | Pulled from submission | Lead score may auto-update if rules configured  |

### 9. Lead scoring (Phase 10 wk 71-72)

| #   | Action                                                | Expected                                       | Verify                                          |
| --- | ----------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| 9.1 | Settings → Lead Scoring → review seeded rules         | Rules listed                                   | `lead_scoring_rules` rows                       |
| 9.2 | Trigger a scored event (e.g. open contact's email)    | `contacts.lead_score` increases by rule amount | Wait for `lead-score-compute` worker to process |
| 9.3 | Verify `lead_grade` updates (A/B/C/D/F) at thresholds | Banner color matches grade                     | UI reflects                                     |

### 10. Review automation (Phase 10 wk 73-74)

| #    | Action                                                 | Expected                                                  | Verify                                     |
| ---- | ------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| 10.1 | Settings → Review Automation → enable, set delay 5 min | Saved                                                     | `tenants.review_automation_enabled = true` |
| 10.2 | Mark an appointment "completed"                        | After 5 min, `review-request` worker dispatches SMS/email | `review_requests` row, message sent        |

### 11. Chat widget (Phase 10 wk 77-78)

| #    | Action                                                      | Expected                         | Verify                                 |
| ---- | ----------------------------------------------------------- | -------------------------------- | -------------------------------------- |
| 11.1 | Settings → Chat Widget → enable, set greeting/color         | Saved                            | `tenants.chat_widget_enabled = true`   |
| 11.2 | Open public booking page → chat bubble appears bottom-right | Bubble visible with greeting     | Tailwind respects color override       |
| 11.3 | Type message → AI responds                                  | Response from `chat-agent` route | `chat_sessions` + `chat_messages` rows |

### 12. Reports (Phase 10 wk 85-86)

| #    | Action                                  | Expected              | Verify                           |
| ---- | --------------------------------------- | --------------------- | -------------------------------- |
| 12.1 | Navigate to `/reports`                  | Seeded reports listed | Rows from `seed-reports.ts`      |
| 12.2 | Click "Lead Conversion" report → run    | Renders chart + table | `report_runs` row, cached for 1h |
| 12.3 | New Report builder → pick fields → save | Custom report saved   | Row in `reports`                 |

### 13. CSV import (Phase 6/Phase 10)

| #    | Action                                                        | Expected             | Verify                                             |
| ---- | ------------------------------------------------------------- | -------------------- | -------------------------------------------------- |
| 13.1 | Settings → Data Import → upload sample contacts CSV (10 rows) | Job created          | `import_jobs` row, BullMQ `csv-import-worker` runs |
| 13.2 | Check progress; refresh contacts list                         | New contacts visible | All 10 imported, no dupes                          |

### 14. Data export (Phase 10 wk 77-78)

| #    | Action                                                    | Expected      | Verify                             |
| ---- | --------------------------------------------------------- | ------------- | ---------------------------------- |
| 14.1 | Settings → Data Export → select "Contacts" → CSV → Export | Job created   | `export_jobs` row                  |
| 14.2 | Wait for completion, click download                       | CSV downloads | Headers + rows match contacts list |

### 15. Calendar sync (Phase 10 wk 79-80)

| #    | Action                                          | Expected          | Verify                                  |
| ---- | ----------------------------------------------- | ----------------- | --------------------------------------- |
| 15.1 | Settings → Calendar → "Connect Google Calendar" | OAuth flow        | Returns connected state                 |
| 15.2 | Create appointment → check Google Calendar app  | Event appears     | Two-way sync working                    |
| 15.3 | Settings → Calendar → "Connect Outlook" instead | Switches provider | `tenants.calendar_provider = 'outlook'` |

### 16. Mobile push (Phase 10 wk 81-84) — Mobile app needed

| #    | Action                                                      | Expected                      | Verify                      |
| ---- | ----------------------------------------------------------- | ----------------------------- | --------------------------- |
| 16.1 | In Expo Go on phone, log in to mobile app                   | Token registered              | Row in `mobile_push_tokens` |
| 16.2 | Trigger an event that sends a push (e.g. new lead assigned) | Notification arrives on phone | Expo push receipt logged    |

### 17. Web push notifications

| #    | Action                                                    | Expected                       | Verify                           |
| ---- | --------------------------------------------------------- | ------------------------------ | -------------------------------- |
| 17.1 | Settings → Notifications → "Enable browser notifications" | Browser prompts for permission | `push_subscriptions` row created |
| 17.2 | Trigger an event                                          | OS notification appears        | `web-push` library log shows 201 |

### 18. Knowledge base + voice (existing)

| #    | Action                                                 | Expected                      | Verify                            |
| ---- | ------------------------------------------------------ | ----------------------------- | --------------------------------- |
| 18.1 | Settings → Knowledge → seeded entries listed           | Rows from `seed-knowledge.ts` | RAG embeddings exist              |
| 18.2 | Test voice call (Telnyx) → Maya answers, looks up info | Response uses knowledge entry | `voice_sessions` row + transcript |

### 19. Webhooks

| #    | Action                                                                          | Expected          | Verify                                      |
| ---- | ------------------------------------------------------------------------------- | ----------------- | ------------------------------------------- |
| 19.1 | Settings → Webhooks → register `https://webhook.site/...` for `contact.created` | Saved             | `webhook_subscriptions` row                 |
| 19.2 | Create a contact                                                                | Webhook delivered | Webhook.site shows POST with signed payload |

### 20. Multi-vertical (demo tenant `0d9a00b9-ce40-4702-a99c-ed23f11fdb08`)

| #    | Action                                                            | Expected                                        | Verify                           |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| 20.1 | Switch to demo tenant; verify each vertical's seeded data renders | All 7 verticals show context-appropriate fields | `vertical_configs` rows for each |

---

## When all 20 sections pass

- All 52 unit tests still passing (`npm test` from repo root)
- No 5xx errors in browser console for any page visited
- API logs show no unhandled exceptions
- Worker logs show repeating jobs firing on schedule

→ **Ready for Azure deploy.**
