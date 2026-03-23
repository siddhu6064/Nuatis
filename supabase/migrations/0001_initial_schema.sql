-- ============================================================
--  NUATIS LLC — PostgreSQL Database Schema
--  Version: 1.0.0
--  Compatible: PostgreSQL 16+ / Supabase
--  Run order: extensions → types → tables → RLS → indexes → seeds
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";          -- pgvector for RAG embeddings


-- ── Custom Types (Enums) ─────────────────────────────────────

CREATE TYPE vertical_type AS ENUM (
  'dental', 'contractor', 'salon', 'law_firm', 'restaurant', 'real_estate'
);

CREATE TYPE subscription_plan AS ENUM ('starter', 'growth', 'pro');

CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
);

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'staff');

CREATE TYPE contact_source AS ENUM (
  'inbound_call', 'web_form', 'manual', 'import', 'referral', 'outbound_call'
);

CREATE TYPE appointment_status AS ENUM (
  'scheduled', 'confirmed', 'completed', 'no_show', 'canceled', 'rescheduled'
);

CREATE TYPE call_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE call_status AS ENUM (
  'ringing', 'active', 'completed', 'missed', 'failed', 'voicemail'
);

CREATE TYPE transcript_role AS ENUM ('user', 'assistant', 'system');

CREATE TYPE pipeline_entry_status AS ENUM ('active', 'won', 'lost');

CREATE TYPE automation_type AS ENUM (
  'appointment_reminder',
  'followup_sequence',
  'no_show_recovery',
  'review_request',
  'missed_call_sms',
  'recall_reminder'
);

CREATE TYPE job_status AS ENUM (
  'queued', 'processing', 'completed', 'failed', 'canceled', 'skipped'
);

CREATE TYPE notification_type AS ENUM ('sms', 'email');

CREATE TYPE notification_channel AS ENUM (
  'appointment_reminder', 'followup', 'no_show', 'review_request',
  'missed_call', 'recall', 'general', 'billing'
);

CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'bounced');

CREATE TYPE doc_content_type AS ENUM ('pdf', 'docx', 'txt', 'manual');


-- ============================================================
--  TABLES
-- ============================================================

-- ── 1. TENANTS ───────────────────────────────────────────────
-- One row per business (Clerk Organization = one tenant)

CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clerk_org_id          TEXT UNIQUE NOT NULL,          -- Clerk Organization ID
  name                  TEXT NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,          -- url-safe identifier e.g. "sunrise-dental"
  vertical              vertical_type NOT NULL,
  stripe_customer_id    TEXT UNIQUE,
  subscription_plan     subscription_plan NOT NULL DEFAULT 'starter',
  subscription_status   subscription_status NOT NULL DEFAULT 'trialing',
  timezone              TEXT NOT NULL DEFAULT 'America/Chicago',
  logo_url              TEXT,
  brand_color           TEXT DEFAULT '#1D9E75',
  voice_id              TEXT,                          -- ElevenLabs voice_id for this business
  ai_persona_name       TEXT DEFAULT 'Nuatis Assistant',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tenants IS 'One row per business. Maps 1:1 with a Clerk Organization.';



-- ── 2. SUBSCRIPTIONS ────────────────────────────────────────
-- Stripe subscription tracking (separate from tenant for clean billing queries)

CREATE TABLE subscriptions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_subscription_id    TEXT UNIQUE NOT NULL,
  stripe_customer_id        TEXT NOT NULL,
  plan                      subscription_plan NOT NULL,
  status                    subscription_status NOT NULL,
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  trial_end                 TIMESTAMPTZ,
  cancel_at                 TIMESTAMPTZ,
  canceled_at               TIMESTAMPTZ,
  voice_minutes_cap         INTEGER NOT NULL DEFAULT 300,   -- included minutes per billing period
  voice_minutes_used        INTEGER NOT NULL DEFAULT 0,
  overage_rate_cents        INTEGER NOT NULL DEFAULT 8,     -- cents per minute over cap
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN subscriptions.voice_minutes_cap IS 'Starter=300, Growth=1000, Pro=3000 mins/mo';


-- ── 3. LOCATIONS ─────────────────────────────────────────────
-- Physical locations / branches of the business

CREATE TABLE locations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  zip                   TEXT,
  country               TEXT NOT NULL DEFAULT 'US',
  phone_display         TEXT,                          -- human-readable display number
  telnyx_number_id      TEXT,                          -- Telnyx DID ID
  telnyx_number         TEXT,                          -- E.164 format: +15125551234
  google_calendar_id    TEXT,                          -- connected calendar
  google_refresh_token  TEXT,                          -- AES-encrypted, rotate on use
  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN locations.google_refresh_token IS 'Encrypted at application layer before storage. Never query raw.';


-- ── 4. USERS ─────────────────────────────────────────────────
-- Staff members belonging to a tenant

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES locations(id) ON DELETE SET NULL,  -- NULL = access all locations
  clerk_user_id   TEXT UNIQUE NOT NULL,
  email           TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  role            user_role NOT NULL DEFAULT 'staff',
  avatar_url      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 5. CONTACTS ──────────────────────────────────────────────
-- Customers / patients / clients — the core CRM entity

CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES locations(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,                   -- E.164 format
  phone_alt       TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  source          contact_source NOT NULL DEFAULT 'manual',
  source_call_id  UUID,                   -- FK to calls — set if contact created from a call
  tags            TEXT[] DEFAULT '{}',
  notes           TEXT,
  vertical_data   JSONB NOT NULL DEFAULT '{}',  -- vertical-specific fields (see comments below)
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  last_contacted  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/*
  vertical_data JSONB shape per vertical:

  DENTAL:
  {
    "date_of_birth": "1985-03-22",
    "insurance_provider": "Delta Dental",
    "insurance_plan_id": "DD-291847",
    "insurance_group_number": "GRP-5542",
    "last_cleaning_date": "2024-09-15",
    "recall_interval_months": 6,
    "preferred_dentist": "Dr. Sarah Kim",
    "preferred_hygienist": "Maria Lopez",
    "treatment_plan_status": "active",   -- active|completed|pending
    "treatment_plan_notes": "Crown on #14, whitening consultation",
    "overdue_treatments": ["Crown #14"],
    "allergies": ["Latex"],
    "hipaa_consent_date": "2023-01-10",
    "emergency_contact_name": "John Patel",
    "emergency_contact_phone": "+15125559988"
  }

  CONTRACTOR:
  {
    "property_address": "4521 Oak Lane, Austin TX 78701",
    "property_type": "residential",   -- residential|commercial
    "last_job_type": "HVAC installation",
    "last_job_date": "2024-06-20",
    "last_job_amount_cents": 450000,
    "estimate_status": "accepted",    -- sent|accepted|expired|rejected
    "estimate_amount_cents": 450000,
    "estimate_sent_date": "2024-06-10",
    "warranty_expiry_date": "2025-06-20",
    "preferred_contact_time": "morning",  -- morning|afternoon|evening|anytime
    "referral_source": "Google",
    "seasonal_reminder_months": [3, 9],   -- trigger reminder campaigns in March + September
    "permit_notes": "City permit #TX-2024-4821 issued",
    "insurance_verified": true
  }

  SALON:
  {
    "preferred_stylist": "Jamie Chen",
    "last_service": "Full balayage",
    "last_service_date": "2024-11-01",
    "color_formula": {
      "developer": "20vol Wella",
      "brand": "Wella Koleston",
      "base": "6/0",
      "highlights": "10/1 + 9/1 mix"
    },
    "hair_type": "fine",      -- fine|medium|coarse|curly|wavy
    "hair_texture": "straight",
    "scalp_type": "normal",   -- normal|oily|dry|sensitive
    "product_allergies": ["PPD dye"],
    "rebooking_interval_weeks": 8,
    "loyalty_points": 240,
    "birthday": "1990-07-04",
    "favourite_products": ["Olaplex No.3", "Moroccanoil"],
    "stylist_notes": "Prefers natural looks. Sensitive scalp — use gentler developer."
  }

  LAW_FIRM:
  {
    "matter_number": "2024-CR-00142",
    "case_type": "criminal_defense",   -- family|criminal_defense|personal_injury|corporate|real_estate|immigration|other
    "assigned_attorney": "David Okonkwo",
    "paralegal": "Sandra Lee",
    "retainer_status": "active",       -- active|depleted|unpaid
    "retainer_balance_cents": 250000,
    "hourly_rate_cents": 45000,
    "next_court_date": "2025-02-14",
    "next_deadline": "2025-01-30",
    "jurisdiction": "Travis County District Court",
    "opposing_counsel": "State of Texas",
    "case_status": "active",           -- active|closed|pending|settled
    "conflict_check_status": "cleared",  -- cleared|pending|conflict
    "conflict_checked_at": "2024-10-01",
    "intake_source": "referral",
    "referred_by": "Michael Torres Esq."
  }

  RESTAURANT:
  {
    "party_size_preference": 2,
    "seating_preference": "corner booth",
    "dietary_restrictions": ["Gluten-free", "Nut allergy"],
    "favourite_dishes": ["Filet mignon", "Caesar salad"],
    "favourite_wine": "Caymus Cabernet",
    "visit_frequency": "monthly",
    "last_visit_date": "2025-01-05",
    "lifetime_visit_count": 18,
    "birthday": "1978-11-12",
    "anniversary": "2003-06-15",
    "special_occasions": ["Wedding anniversary June 15"],
    "no_show_count": 0,
    "vip_status": true
  }

  REAL_ESTATE:
  {
    "buyer_or_seller": "buyer",
    "budget_min_cents": 40000000,
    "budget_max_cents": 60000000,
    "target_neighborhoods": ["South Congress", "Travis Heights"],
    "bedrooms_min": 3,
    "bathrooms_min": 2,
    "must_haves": ["Home office", "2-car garage"],
    "pre_approval_status": "approved",
    "pre_approval_lender": "Chase",
    "pre_approval_amount_cents": 55000000,
    "target_close_date": "2025-04-01",
    "assigned_agent": "Rebecca Stone",
    "showings_count": 7,
    "last_showing_address": "2210 S 5th St Austin TX",
    "mls_saved_searches": ["ATX-SFH-3BR-4-600k"]
  }
*/


-- ── 6. PHONE NUMBERS ─────────────────────────────────────────
-- Provisioned Telnyx DIDs per tenant/location

CREATE TABLE phone_numbers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id       UUID REFERENCES locations(id) ON DELETE SET NULL,
  number            TEXT NOT NULL,           -- E.164: +15125551234
  telnyx_number_id  TEXT UNIQUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  provisioned_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 7. CALLS ─────────────────────────────────────────────────
-- Every inbound/outbound call — AI-handled or missed

CREATE TABLE calls (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id             UUID REFERENCES locations(id) ON DELETE SET NULL,
  phone_number_id         UUID REFERENCES phone_numbers(id) ON DELETE SET NULL,
  contact_id              UUID REFERENCES contacts(id) ON DELETE SET NULL,  -- matched post-call
  caller_number           TEXT NOT NULL,             -- E.164 caller ID
  direction               call_direction NOT NULL DEFAULT 'inbound',
  status                  call_status NOT NULL DEFAULT 'ringing',
  duration_seconds        INTEGER DEFAULT 0,
  recording_s3_key        TEXT,                      -- S3 object key
  recording_url           TEXT,                      -- CloudFront pre-signed URL (ephemeral)
  telnyx_call_control_id  TEXT UNIQUE,               -- Telnyx session identifier
  telnyx_leg_id           TEXT,
  -- AI conversation metadata
  ai_handled              BOOLEAN NOT NULL DEFAULT FALSE,
  ai_intent               TEXT,                      -- what the caller wanted
  ai_outcome              TEXT,                      -- appointment_booked|info_provided|escalated|missed
  appointment_booked_id   UUID,                      -- FK to appointments if AI booked one
  -- Cost tracking (in cents)
  cost_telnyx_cents       INTEGER DEFAULT 0,
  cost_deepgram_cents     INTEGER DEFAULT 0,
  cost_claude_cents       INTEGER DEFAULT 0,
  cost_elevenlabs_cents   INTEGER DEFAULT 0,
  cost_total_cents        INTEGER GENERATED ALWAYS AS (
    COALESCE(cost_telnyx_cents,0) +
    COALESCE(cost_deepgram_cents,0) +
    COALESCE(cost_claude_cents,0) +
    COALESCE(cost_elevenlabs_cents,0)
  ) STORED,
  started_at              TIMESTAMPTZ,
  ended_at                TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN calls.cost_total_cents IS 'Auto-computed from individual cost columns.';
COMMENT ON COLUMN calls.ai_outcome IS 'appointment_booked | info_provided | escalated | missed | voicemail';


-- ── 8. CALL TRANSCRIPTS ──────────────────────────────────────
-- Turn-by-turn transcript of every AI call

CREATE TABLE call_transcripts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id       UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role          transcript_role NOT NULL,
  content       TEXT NOT NULL,
  sequence_num  INTEGER NOT NULL,           -- ordering within the call
  timestamp_ms  INTEGER NOT NULL DEFAULT 0, -- milliseconds from call start
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 9. APPOINTMENTS ──────────────────────────────────────────

CREATE TABLE appointments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id       UUID REFERENCES locations(id) ON DELETE SET NULL,
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  assigned_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_call   UUID REFERENCES calls(id) ON DELETE SET NULL,  -- set if AI booked it
  google_event_id   TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  status            appointment_status NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  internal_notes    TEXT,
  reminder_24h_sent BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_2h_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  review_requested  BOOLEAN NOT NULL DEFAULT FALSE,
  no_show_sms_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  canceled_at       TIMESTAMPTZ,
  cancellation_reason TEXT,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_times CHECK (end_time > start_time)
);


-- ── 10. PIPELINE STAGES ──────────────────────────────────────
-- Configurable Kanban stages per tenant

CREATE TABLE pipeline_stages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL,           -- sort order
  color         TEXT NOT NULL DEFAULT '#888780',
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,  -- where new leads land
  is_terminal   BOOLEAN NOT NULL DEFAULT FALSE,  -- won/lost stages
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, position)
);


-- ── 11. PIPELINE ENTRIES ─────────────────────────────────────
-- A contact's current (and historical) position in the pipeline

CREATE TABLE pipeline_entries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage_id          UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  assigned_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  status            pipeline_entry_status NOT NULL DEFAULT 'active',
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes             TEXT,
  value_cents       INTEGER DEFAULT 0,       -- estimated deal value
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 12. AUTOMATION RULES ─────────────────────────────────────
-- Per-tenant automation configuration

CREATE TABLE automation_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        automation_type NOT NULL,
  name        TEXT NOT NULL,
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  config      JSONB NOT NULL DEFAULT '{}',
  /*
    config shapes by type:

    appointment_reminder:
    {
      "send_24h_before": true,
      "send_2h_before": true,
      "sms_template": "Hi {{contact_name}}, reminder: your appointment at {{business_name}} is tomorrow at {{time}}. Reply C to confirm or call {{phone}} to reschedule.",
      "email_template": "..."
    }

    followup_sequence:
    {
      "steps": [
        { "delay_hours": 24,  "channel": "sms", "template": "Hi {{name}}, thanks for calling {{business_name}}..." },
        { "delay_hours": 72,  "channel": "sms", "template": "Still interested? We'd love to help..." },
        { "delay_hours": 168, "channel": "email","template": "Final follow-up..." }
      ]
    }

    no_show_recovery:
    {
      "delay_minutes": 30,
      "sms_template": "We missed you today! Would you like to reschedule? Book at: {{booking_link}}"
    }

    review_request:
    {
      "delay_hours": 2,
      "sms_template": "Thanks for visiting {{business_name}}! We'd love your feedback: {{review_link}}",
      "google_place_id": "ChIJ..."
    }

    missed_call_sms:
    {
      "delay_seconds": 60,
      "sms_template": "Hi! We missed your call at {{business_name}}. How can we help? Reply or call us back at {{phone}}"
    }

    recall_reminder:
    {
      "trigger_field": "last_cleaning_date",
      "interval_months_field": "recall_interval_months",
      "default_interval_months": 6,
      "sms_template": "Hi {{name}}, it's time for your {{interval}}-month check-up at {{business_name}}..."
    }
  */
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, type)
);


-- ── 13. AUTOMATION JOBS ──────────────────────────────────────
-- BullMQ job audit log (every enqueued/completed/failed job)

CREATE TABLE automation_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id           UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
  contact_id        UUID REFERENCES contacts(id) ON DELETE CASCADE,
  appointment_id    UUID REFERENCES appointments(id) ON DELETE SET NULL,
  bullmq_job_id     TEXT,                   -- BullMQ internal job ID
  type              automation_type NOT NULL,
  status            job_status NOT NULL DEFAULT 'queued',
  step_index        INTEGER DEFAULT 0,      -- for multi-step sequences
  payload           JSONB NOT NULL DEFAULT '{}',
  result            JSONB,
  error_message     TEXT,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  scheduled_for     TIMESTAMPTZ NOT NULL,
  executed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 14. NOTIFICATIONS ────────────────────────────────────────
-- Audit log of every SMS and email sent

CREATE TABLE notifications (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  automation_job_id     UUID REFERENCES automation_jobs(id) ON DELETE SET NULL,
  type                  notification_type NOT NULL,
  channel               notification_channel NOT NULL,
  to_address            TEXT NOT NULL,             -- phone (E.164) or email
  subject               TEXT,                      -- email only
  body                  TEXT NOT NULL,
  status                notification_status NOT NULL DEFAULT 'queued',
  provider              TEXT NOT NULL DEFAULT 'telnyx',  -- telnyx | resend | sendgrid
  provider_message_id   TEXT,                      -- Telnyx/Resend message ID
  cost_cents            INTEGER DEFAULT 0,
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 15. KNOWLEDGE DOCS ───────────────────────────────────────
-- Business-uploaded documents for RAG (FAQs, menus, pricing, policies)

CREATE TABLE knowledge_docs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  filename        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  content_type    doc_content_type NOT NULL DEFAULT 'txt',
  s3_key          TEXT,                     -- raw file in S3
  file_size_bytes INTEGER,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── 16. KNOWLEDGE CHUNKS ─────────────────────────────────────
-- Chunked text + OpenAI embeddings (pgvector)

CREATE TABLE knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_id          UUID NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  chunk_text      TEXT NOT NULL,
  embedding       VECTOR(1536) NOT NULL,    -- OpenAI text-embedding-3-small = 1536 dims
  chunk_index     INTEGER NOT NULL,         -- position within the document
  token_count     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
--  ROW LEVEL SECURITY (RLS)
--  All queries automatically filtered by tenant_id
--  App must set: SET app.current_tenant_id = '<uuid>';
-- ============================================================

ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_numbers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls                ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_docs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks     ENABLE ROW LEVEL SECURITY;

-- Helper function: get current tenant from session variable
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
$$ LANGUAGE sql STABLE;

-- RLS policies — tenant isolation on every table
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_tenant_id());

CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON locations
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON phone_numbers
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON calls
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON call_transcripts
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON pipeline_stages
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON pipeline_entries
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON automation_rules
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON automation_jobs
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON knowledge_docs
  USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_isolation ON knowledge_chunks
  USING (tenant_id = current_tenant_id());


-- ============================================================
--  INDEXES
-- ============================================================

-- Tenants
CREATE INDEX idx_tenants_clerk_org        ON tenants(clerk_org_id);
CREATE INDEX idx_tenants_vertical         ON tenants(vertical);
CREATE INDEX idx_tenants_subscription     ON tenants(subscription_status);

-- Contacts
CREATE INDEX idx_contacts_tenant          ON contacts(tenant_id);
CREATE INDEX idx_contacts_phone           ON contacts(tenant_id, phone);
CREATE INDEX idx_contacts_email           ON contacts(tenant_id, email);
CREATE INDEX idx_contacts_location        ON contacts(location_id);
CREATE INDEX idx_contacts_vertical_data   ON contacts USING GIN(vertical_data);  -- JSONB search
CREATE INDEX idx_contacts_created         ON contacts(tenant_id, created_at DESC);
CREATE INDEX idx_contacts_last_contacted  ON contacts(tenant_id, last_contacted DESC NULLS LAST);

-- Calls
CREATE INDEX idx_calls_tenant             ON calls(tenant_id);
CREATE INDEX idx_calls_contact            ON calls(contact_id);
CREATE INDEX idx_calls_started            ON calls(tenant_id, started_at DESC);
CREATE INDEX idx_calls_status             ON calls(tenant_id, status);
CREATE INDEX idx_calls_telnyx_control     ON calls(telnyx_call_control_id);
CREATE INDEX idx_calls_caller_number      ON calls(tenant_id, caller_number);

-- Call transcripts
CREATE INDEX idx_transcripts_call         ON call_transcripts(call_id, sequence_num);

-- Appointments
CREATE INDEX idx_appts_tenant             ON appointments(tenant_id);
CREATE INDEX idx_appts_contact            ON appointments(contact_id);
CREATE INDEX idx_appts_start_time         ON appointments(tenant_id, start_time);
CREATE INDEX idx_appts_status             ON appointments(tenant_id, status);
CREATE INDEX idx_appts_location           ON appointments(location_id);
CREATE INDEX idx_appts_reminder           ON appointments(tenant_id, reminder_24h_sent, start_time)
  WHERE status = 'scheduled' AND reminder_24h_sent = FALSE;

-- Pipeline
CREATE INDEX idx_pipeline_entries_tenant  ON pipeline_entries(tenant_id);
CREATE INDEX idx_pipeline_entries_stage   ON pipeline_entries(stage_id);
CREATE INDEX idx_pipeline_entries_contact ON pipeline_entries(contact_id);
CREATE INDEX idx_pipeline_entries_active  ON pipeline_entries(tenant_id, status)
  WHERE status = 'active';

-- Automation
CREATE INDEX idx_auto_jobs_tenant         ON automation_jobs(tenant_id);
CREATE INDEX idx_auto_jobs_status         ON automation_jobs(status, scheduled_for)
  WHERE status = 'queued';
CREATE INDEX idx_auto_jobs_contact        ON automation_jobs(contact_id);
CREATE INDEX idx_auto_jobs_appointment    ON automation_jobs(appointment_id);

-- Notifications
CREATE INDEX idx_notifs_tenant            ON notifications(tenant_id);
CREATE INDEX idx_notifs_contact           ON notifications(contact_id);
CREATE INDEX idx_notifs_status            ON notifications(status, created_at DESC);

-- Knowledge chunks — HNSW index for fast vector similarity search
CREATE INDEX idx_chunks_embedding         ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_chunks_tenant_doc        ON knowledge_chunks(tenant_id, doc_id);

-- Subscriptions
CREATE INDEX idx_subscriptions_tenant     ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_stripe     ON subscriptions(stripe_subscription_id);


-- ============================================================
--  UTILITY FUNCTIONS
-- ============================================================

-- Auto-update updated_at on any table that has it
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automation_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RAG: similarity search function
-- Usage: SELECT * FROM search_knowledge('my-tenant-uuid', 'what are your hours', 5);
CREATE OR REPLACE FUNCTION search_knowledge(
  p_tenant_id   UUID,
  p_query_embed VECTOR(1536),
  p_limit       INTEGER DEFAULT 5
)
RETURNS TABLE(
  chunk_id    UUID,
  doc_id      UUID,
  doc_name    TEXT,
  chunk_text  TEXT,
  similarity  FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.doc_id,
    kd.display_name,
    kc.chunk_text,
    1 - (kc.embedding <=> p_query_embed) AS similarity
  FROM knowledge_chunks kc
  JOIN knowledge_docs kd ON kd.id = kc.doc_id
  WHERE kc.tenant_id = p_tenant_id
    AND kd.is_active = TRUE
  ORDER BY kc.embedding <=> p_query_embed
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Analytics: call cost summary per tenant for billing period
CREATE OR REPLACE FUNCTION get_call_cost_summary(
  p_tenant_id   UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end   TIMESTAMPTZ
)
RETURNS TABLE(
  total_calls          BIGINT,
  ai_handled_calls     BIGINT,
  total_duration_mins  NUMERIC,
  total_cost_cents     BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE ai_handled = TRUE)::BIGINT,
    ROUND(SUM(duration_seconds) / 60.0, 1),
    SUM(cost_total_cents)::BIGINT
  FROM calls
  WHERE tenant_id = p_tenant_id
    AND started_at BETWEEN p_period_start AND p_period_end
    AND status = 'completed';
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================
--  SEED DATA — default pipeline stages per vertical
--  Run after tenant creation during onboarding
-- ============================================================

CREATE OR REPLACE FUNCTION seed_pipeline_stages(p_tenant_id UUID, p_vertical vertical_type)
RETURNS VOID AS $$
BEGIN
  IF p_vertical = 'dental' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New inquiry',       1, '#888780', TRUE),
      (p_tenant_id, 'Consultation booked', 2, '#378ADD', FALSE),
      (p_tenant_id, 'Treatment planned',  3, '#EF9F27', FALSE),
      (p_tenant_id, 'Active patient',     4, '#1D9E75', FALSE),
      (p_tenant_id, 'Recall due',         5, '#D85A30', FALSE);

  ELSIF p_vertical = 'contractor' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New lead',       1, '#888780', TRUE),
      (p_tenant_id, 'Estimate sent',  2, '#378ADD', FALSE),
      (p_tenant_id, 'Estimate accepted', 3, '#EF9F27', FALSE),
      (p_tenant_id, 'Job scheduled',  4, '#1D9E75', FALSE),
      (p_tenant_id, 'Job completed',  5, '#7F77DD', FALSE);

  ELSIF p_vertical = 'salon' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New client',     1, '#888780', TRUE),
      (p_tenant_id, 'First booked',   2, '#378ADD', FALSE),
      (p_tenant_id, 'Returning',      3, '#1D9E75', FALSE),
      (p_tenant_id, 'VIP',            4, '#7F77DD', FALSE),
      (p_tenant_id, 'Lapsed',         5, '#D85A30', FALSE);

  ELSIF p_vertical = 'law_firm' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New inquiry',       1, '#888780', TRUE),
      (p_tenant_id, 'Conflict check',    2, '#378ADD', FALSE),
      (p_tenant_id, 'Consultation set',  3, '#EF9F27', FALSE),
      (p_tenant_id, 'Retained',          4, '#1D9E75', FALSE),
      (p_tenant_id, 'Active matter',     5, '#7F77DD', FALSE);

  ELSIF p_vertical = 'restaurant' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New guest',   1, '#888780', TRUE),
      (p_tenant_id, 'Returning',   2, '#1D9E75', FALSE),
      (p_tenant_id, 'Regular',     3, '#378ADD', FALSE),
      (p_tenant_id, 'VIP',         4, '#7F77DD', FALSE);

  ELSIF p_vertical = 'real_estate' THEN
    INSERT INTO pipeline_stages (tenant_id, name, position, color, is_default) VALUES
      (p_tenant_id, 'New lead',        1, '#888780', TRUE),
      (p_tenant_id, 'Qualified',       2, '#378ADD', FALSE),
      (p_tenant_id, 'Showing booked',  3, '#EF9F27', FALSE),
      (p_tenant_id, 'Offer stage',     4, '#D85A30', FALSE),
      (p_tenant_id, 'Under contract',  5, '#1D9E75', FALSE);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Seed default automation rules for a new tenant
CREATE OR REPLACE FUNCTION seed_automation_rules(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO automation_rules (tenant_id, type, name, is_enabled, config) VALUES
    (p_tenant_id, 'appointment_reminder', 'Appointment reminder', TRUE,
      '{"send_24h_before": true, "send_2h_before": true, "sms_template": "Hi {{contact_name}}, reminder: your appointment is tomorrow at {{time}} with {{business_name}}. Reply C to confirm or call {{phone}} to reschedule."}'),
    (p_tenant_id, 'followup_sequence', 'New lead follow-up', TRUE,
      '{"steps": [{"delay_hours": 24, "channel": "sms", "template": "Hi {{contact_name}}, thanks for reaching out to {{business_name}}! We would love to help. Call us at {{phone}} or reply here."}, {"delay_hours": 72, "channel": "sms", "template": "Still thinking about it? We are here when you are ready. — {{business_name}}"}, {"delay_hours": 168, "channel": "sms", "template": "Last check-in from {{business_name}}. Book anytime at {{booking_link}} or call {{phone}}."}]}'),
    (p_tenant_id, 'no_show_recovery', 'No-show recovery', TRUE,
      '{"delay_minutes": 30, "sms_template": "We missed you today at {{business_name}}! Would you like to reschedule? Book at: {{booking_link}} or reply to this message."}'),
    (p_tenant_id, 'review_request', 'Review request', TRUE,
      '{"delay_hours": 2, "sms_template": "Thanks for visiting {{business_name}}! We hope it was great. Mind leaving us a quick review? It really helps: {{review_link}}"}'),
    (p_tenant_id, 'missed_call_sms', 'Missed call SMS', TRUE,
      '{"delay_seconds": 60, "sms_template": "Hi! We missed your call at {{business_name}}. How can we help? Reply here or call us back at {{phone}}."}');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
--  SCHEMA VERSION
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_versions (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT
);

INSERT INTO schema_versions (version, description)
VALUES ('1.0.0', 'Initial Nuatis schema — tenants, contacts, calls, appointments, pipeline, automations, RAG');
