# G2 PDF Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tenants upload PDF files that Maya reads at call time — extracted text is injected into the Gemini system prompt alongside the business profile block.

**Architecture:** A `maya_kb_files` table stores file metadata and Gemini-extracted text. An Express route handles multipart upload (multer), Supabase Storage holds the raw PDFs, and a fire-and-forget extractor sends each PDF to Gemini 2.0 Flash as `inlineData`. At call time, `getLocationConfig` in `telnyx-handler.ts` queries ready files and passes them to `createGeminiLiveSession`, which appends an `--- UPLOADED DOCUMENTS ---` block after the existing `--- BUSINESS KNOWLEDGE ---` block. The settings UI is a new client component (`KnowledgeFilesCard`) added to the existing Voice AI settings page.

**Tech Stack:** PostgreSQL/Supabase (table + Storage), Express + multer, `@google/genai` (already installed), Next.js 14 App Router, Tailwind CSS, Jest (ts-jest ESM)

---

## File Map

| Action | Path                                                                 | Responsibility                                               |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Modify | `packages/shared/src/types/index.ts`                                 | Add `MayaKbFileStatus`, `MayaKbFile`                         |
| Create | `supabase/migrations/0083_maya_kb_files.sql`                         | Create `maya_kb_files` table + index                         |
| Create | `apps/api/src/routes/maya-kb.ts`                                     | GET / POST /upload / DELETE /:id                             |
| Modify | `apps/api/src/index.ts`                                              | Register `/api/maya-kb` router                               |
| Create | `apps/api/src/voice/maya-kb-extractor.ts`                            | `extractPdfText` — download + Gemini OCR + DB update         |
| Create | `apps/api/src/voice/__tests__/maya-kb-extractor.test.ts`             | 3 unit tests for `buildKbFilesBlock`                         |
| Modify | `apps/api/src/voice/business-knowledge.ts`                           | Add `buildKbFilesBlock` export                               |
| Modify | `apps/api/src/voice/gemini-live.ts`                                  | Add `kbFiles` param, inject block after business profile     |
| Modify | `apps/api/src/voice/telnyx-handler.ts`                               | Extend `LocationConfig`, add KB files query, pass to session |
| Create | `apps/web/src/app/(dashboard)/settings/voice/KnowledgeFilesCard.tsx` | Client component: list, upload, delete, poll                 |
| Modify | `apps/web/src/app/(dashboard)/settings/voice/page.tsx`               | Fetch kb files server-side, render KnowledgeFilesCard        |

---

## Task 1: Shared TypeScript Types

**Files:**

- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1.1: Append MayaKbFile types to end of shared types**

Open `packages/shared/src/types/index.ts`. Append after the `BusinessProfile` interface (at the very end of the file):

```typescript
// ── Maya KB Files ─────────────────────────────────────────────

export type MayaKbFileStatus = 'pending' | 'processing' | 'ready' | 'error'

export interface MayaKbFile {
  id: string
  tenantId: string
  locationId: string | null
  fileName: string
  fileSize: number
  storagePath: string
  extractedText: string | null
  status: MayaKbFileStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 1.2: Build shared package to update dist**

```bash
cd ~/Documents/Nuatis/nuatis && npm run build -w packages/shared 2>&1 | tail -5
```

Expected: `tsc` exits 0, no errors.

- [ ] **Step 1.3: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p packages/shared/tsconfig.json 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 1.4: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add packages/shared/src/types/index.ts && git commit -m "feat(types): add MayaKbFile and MayaKbFileStatus"
```

---

## Task 2: Database Migration 0083

**Files:**

- Create: `supabase/migrations/0083_maya_kb_files.sql`

- [ ] **Step 2.1: Create migration file**

Create `supabase/migrations/0083_maya_kb_files.sql` with this exact content:

```sql
-- G2: Maya knowledge base file uploads
CREATE TABLE maya_kb_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready','error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON maya_kb_files(tenant_id);
```

- [ ] **Step 2.2: Apply migration**

```bash
cd ~/Documents/Nuatis/nuatis && npx supabase db push 2>&1 | tail -10
```

Expected: migration applied, no errors.

- [ ] **Step 2.3: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add supabase/migrations/0083_maya_kb_files.sql && git commit -m "feat(db): add maya_kb_files table (migration 0083)"
```

---

## Task 3: Install multer + API Routes

**Files:**

- Create: `apps/api/src/routes/maya-kb.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 3.1: Install multer**

```bash
cd ~/Documents/Nuatis/nuatis && npm install multer @types/multer -w apps/api 2>&1 | tail -5
```

Expected: packages added to `apps/api/package.json` and `node_modules`.

- [ ] **Step 3.2: Create the route file**

Create `apps/api/src/routes/maya-kb.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { extractPdfText } from '../voice/maya-kb-extractor.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are allowed'))
    }
  },
})

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function ensureBucket(): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase.storage.createBucket('maya-kb', { public: false })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    console.warn('[maya-kb] bucket create warning:', error.message)
  }
}

// ── GET /api/maya-kb — list files for tenant ─────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('maya_kb_files')
      .select('id, file_name, file_size, status, created_at')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      res.status(500).json({ error: 'Failed to fetch files' })
      return
    }

    res.json({ files: data ?? [] })
  } catch (err) {
    console.error('[maya-kb] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/maya-kb/upload ──────────────────────────────────────────────────
router.post(
  '/upload',
  requireAuth,
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'File too large (max 10MB)' })
        return
      }
      if (err) {
        res.status(400).json({ error: (err as Error).message })
        return
      }
      next()
    })
  },
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const file = req.file

    if (!file) {
      res.status(400).json({ error: 'No file provided' })
      return
    }

    const supabase = getSupabase()

    try {
      await ensureBucket()

      const id = crypto.randomUUID()
      const storagePath = `${authed.tenantId}/${id}.pdf`

      const { error: uploadError } = await supabase.storage
        .from('maya-kb')
        .upload(storagePath, file.buffer, { contentType: 'application/pdf' })

      if (uploadError) {
        console.error('[maya-kb] storage upload error:', uploadError.message)
        res.status(500).json({ error: 'Storage upload failed' })
        return
      }

      const { error: dbError } = await supabase.from('maya_kb_files').insert({
        id,
        tenant_id: authed.tenantId,
        file_name: file.originalname,
        file_size: file.size,
        storage_path: storagePath,
        status: 'pending',
      })

      if (dbError) {
        // Clean up orphaned storage object
        await supabase.storage.from('maya-kb').remove([storagePath])
        console.error('[maya-kb] DB insert error:', dbError.message)
        res.status(500).json({ error: 'Failed to save file record' })
        return
      }

      // Fire-and-forget extraction — never await
      extractPdfText({ id, storage_path: storagePath }).catch((err: unknown) =>
        console.error('[maya-kb] extraction error:', err)
      )

      console.info(
        `[maya-kb] uploaded file=${file.originalname} id=${id} tenant=${authed.tenantId}`
      )
      res.json({ id, file_name: file.originalname, status: 'pending' })
    } catch (err) {
      console.error('[maya-kb] upload error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ── DELETE /api/maya-kb/:id ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const { id } = req.params as { id: string }
  const supabase = getSupabase()

  try {
    const { data: file } = await supabase
      .from('maya_kb_files')
      .select('storage_path')
      .eq('id', id)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ storage_path: string }>()

    if (!file) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    await supabase.storage.from('maya-kb').remove([file.storage_path])

    await supabase.from('maya_kb_files').delete().eq('id', id).eq('tenant_id', authed.tenantId)

    console.info(`[maya-kb] deleted file id=${id} tenant=${authed.tenantId}`)
    res.json({ success: true })
  } catch (err) {
    console.error('[maya-kb] DELETE error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
```

- [ ] **Step 3.3: Register router in apps/api/src/index.ts**

Add the import at line ~17 (after the `businessProfileRouter` import):

```typescript
import mayaKbRouter from './routes/maya-kb.js'
```

Add the mount immediately after `app.use('/api/business-profile', businessProfileRouter)` (line ~117):

```typescript
app.use('/api/maya-kb', mayaKbRouter)
```

- [ ] **Step 3.4: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep "error TS" | grep -v "node_modules" | head -20
```

Expected: 0 errors. (Note: `maya-kb-extractor.js` doesn't exist yet — if TypeScript errors about missing module, that's expected and will be fixed in Task 4.)

- [ ] **Step 3.5: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add apps/api/src/routes/maya-kb.ts apps/api/src/index.ts apps/api/package.json package-lock.json && git commit -m "feat(api): add GET/POST/DELETE /api/maya-kb routes with multer upload"
```

---

## Task 4: PDF Extractor

**Files:**

- Create: `apps/api/src/voice/maya-kb-extractor.ts`

- [ ] **Step 4.1: Create the extractor**

Create `apps/api/src/voice/maya-kb-extractor.ts`:

```typescript
import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'

interface KbFileRecord {
  id: string
  storage_path: string
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function extractPdfText(fileRecord: KbFileRecord): Promise<void> {
  const supabase = getSupabase()

  // Mark as processing
  await supabase
    .from('maya_kb_files')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', fileRecord.id)

  try {
    // Download from Supabase Storage
    const { data: blob, error: downloadError } = await supabase.storage
      .from('maya-kb')
      .download(fileRecord.storage_path)

    if (downloadError || !blob) {
      throw new Error(downloadError?.message ?? 'Storage download returned no data')
    }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const base64Pdf = buffer.toString('base64')

    // Extract text via Gemini
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) throw new Error('GEMINI_API_KEY not set')

    const genai = new GoogleGenAI({ apiKey })
    const result = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              text: 'Extract all text from this document. Preserve structure — headings, lists, tables as plain text. Return only the extracted text, no commentary.',
            },
          ],
        },
      ],
    })

    const extractedText = result.text ?? ''

    await supabase
      .from('maya_kb_files')
      .update({
        extracted_text: extractedText,
        status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileRecord.id)

    console.info(
      `[maya-kb-extractor] extracted ${extractedText.length} chars for file=${fileRecord.id}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[maya-kb-extractor] extraction failed for file=${fileRecord.id}:`, message)

    await supabase
      .from('maya_kb_files')
      .update({
        status: 'error',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileRecord.id)
  }
}
```

- [ ] **Step 4.2: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep "error TS" | grep -v "node_modules" | head -20
```

Expected: 0 errors.

- [ ] **Step 4.3: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add apps/api/src/voice/maya-kb-extractor.ts && git commit -m "feat(voice): add extractPdfText — Gemini 2.0 Flash PDF OCR"
```

---

## Task 5: buildKbFilesBlock + Tests (TDD)

**Files:**

- Create: `apps/api/src/voice/__tests__/maya-kb-extractor.test.ts`
- Modify: `apps/api/src/voice/business-knowledge.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `apps/api/src/voice/__tests__/maya-kb-extractor.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals'
import { buildKbFilesBlock } from '../business-knowledge.js'

describe('buildKbFilesBlock', () => {
  it('returns empty string for empty array', () => {
    expect(buildKbFilesBlock([])).toBe('')
  })

  it('skips files with null extracted_text', () => {
    const files = [
      { file_name: 'doc.pdf', extracted_text: null },
      { file_name: 'other.pdf', extracted_text: '' },
    ]
    expect(buildKbFilesBlock(files)).toBe('')
  })

  it('returns correct block for 2 ready files', () => {
    const files = [
      { file_name: 'menu.pdf', extracted_text: 'Appetizers: soup, salad' },
      { file_name: 'hours.pdf', extracted_text: 'Mon-Fri 9am-5pm' },
    ]
    const result = buildKbFilesBlock(files)
    expect(result).toContain('--- UPLOADED DOCUMENTS ---')
    expect(result).toContain('[menu.pdf]:')
    expect(result).toContain('Appetizers: soup, salad')
    expect(result).toContain('[hours.pdf]:')
    expect(result).toContain('Mon-Fri 9am-5pm')
    expect(result.startsWith('\n\n--- UPLOADED DOCUMENTS ---')).toBe(true)
  })
})
```

- [ ] **Step 5.2: Run tests to confirm they fail**

```bash
cd ~/Documents/Nuatis/nuatis && npx jest apps/api/src/voice/__tests__/maya-kb-extractor.test.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `SyntaxError` or `does not provide an export named 'buildKbFilesBlock'`.

- [ ] **Step 5.3: Add buildKbFilesBlock to business-knowledge.ts**

Open `apps/api/src/voice/business-knowledge.ts`. Append after the closing `}` of `buildBusinessKnowledgeBlock`:

```typescript
export function buildKbFilesBlock(
  files: Array<{ file_name: string; extracted_text: string | null }>
): string {
  const ready = files.filter((f) => f.extracted_text && f.extracted_text.trim())
  if (ready.length === 0) return ''

  let block = '\n\n--- UPLOADED DOCUMENTS ---\n'
  for (const f of ready) {
    block += `[${f.file_name}]:\n${f.extracted_text!}\n---\n`
  }
  return block
}
```

- [ ] **Step 5.4: Run tests to confirm they pass**

```bash
cd ~/Documents/Nuatis/nuatis && npx jest apps/api/src/voice/__tests__/maya-kb-extractor.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 3 tests PASS.

- [ ] **Step 5.5: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add apps/api/src/voice/__tests__/maya-kb-extractor.test.ts apps/api/src/voice/business-knowledge.ts && git commit -m "feat(voice): add buildKbFilesBlock with tests"
```

---

## Task 6: Inject KB Files into Gemini System Prompt

**Files:**

- Modify: `apps/api/src/voice/gemini-live.ts`
- Modify: `apps/api/src/voice/telnyx-handler.ts`

- [ ] **Step 6.1: Update gemini-live.ts import**

In `apps/api/src/voice/gemini-live.ts`, line 13 currently reads:

```typescript
import { buildBusinessKnowledgeBlock } from './business-knowledge.js'
```

Change to:

```typescript
import { buildBusinessKnowledgeBlock, buildKbFilesBlock } from './business-knowledge.js'
```

- [ ] **Step 6.2: Add kbFiles parameter to createGeminiLiveSession**

The current signature (around line 121) ends with `businessProfile?: BusinessProfile | null`. Add `kbFiles` as the 10th parameter:

```typescript
export async function createGeminiLiveSession(
  tenantId: string,
  vertical: string,
  businessName?: string,
  callControlId?: string,
  product?: 'maya_only' | 'suite',
  promptSuffix?: string,
  callerContactId?: string | null,
  afterHoursPrefix?: string,
  businessProfile?: BusinessProfile | null,
  kbFiles?: Array<{ file_name: string; extracted_text: string }> | null
): Promise<GeminiLiveSession> {
```

- [ ] **Step 6.3: Inject KB files block after business profile block**

Find the current injection block (around line 178–187):

```typescript
if (businessProfile) {
  const block = buildBusinessKnowledgeBlock(businessProfile)
  if (block) {
    systemPrompt += block
    console.info(`[gemini-live] injected business knowledge block for tenant=${tenantId}`)
  }
}

systemPrompt += BOOKING_CONTRACT
```

Replace with:

```typescript
if (businessProfile) {
  const block = buildBusinessKnowledgeBlock(businessProfile)
  if (block) {
    systemPrompt += block
    console.info(`[gemini-live] injected business knowledge block for tenant=${tenantId}`)
  }
}

if (kbFiles && kbFiles.length > 0) {
  const kbBlock = buildKbFilesBlock(kbFiles)
  if (kbBlock) {
    systemPrompt += kbBlock
    console.info(`[gemini-live] injected ${kbFiles.length} KB files for tenant=${tenantId}`)
  }
}

systemPrompt += BOOKING_CONTRACT
```

(Remove the old bare `systemPrompt += BOOKING_CONTRACT` line.)

- [ ] **Step 6.4: Update telnyx-handler.ts — extend LocationConfig**

In `apps/api/src/voice/telnyx-handler.ts`, find the `LocationConfig` interface (around line 114):

```typescript
interface LocationConfig {
  afterHoursConfig: LocationAfterHoursConfig | null
  businessProfile: BusinessProfile | null
}
```

Change to:

```typescript
interface LocationConfig {
  afterHoursConfig: LocationAfterHoursConfig | null
  businessProfile: BusinessProfile | null
  kbFiles: Array<{ file_name: string; extracted_text: string }> | null
}
```

- [ ] **Step 6.5: Update telnyx-handler.ts — extend FALLBACK and query**

Find `getLocationConfig` (around line 146). Update `FALLBACK`:

```typescript
const FALLBACK: LocationConfig = { afterHoursConfig: null, businessProfile: null, kbFiles: null }
```

Inside the `query` async function (around line 164), the current code does a single `supabase.from('locations').select(...)`. Replace the entire inner `try` block with a version that runs two parallel queries:

```typescript
try {
  const [locResult, kbResult] = await Promise.all([
    supabase
      .from('locations')
      .select(
        'after_hours_enabled, business_hours, after_hours_message, timezone, business_profile'
      )
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .single(),
    supabase
      .from('maya_kb_files')
      .select('file_name, extracted_text')
      .eq('tenant_id', tenantId)
      .eq('status', 'ready'),
  ])

  if (timedOut || locResult.error || !locResult.data) return FALLBACK

  const d = locResult.data as {
    after_hours_enabled?: boolean
    business_hours?: Record<string, AfterHoursDayConfig>
    after_hours_message?: string
    timezone?: string
    business_profile?: BusinessProfile | null
  }

  const afterHoursConfig: LocationAfterHoursConfig | null = d.after_hours_enabled
    ? {
        afterHoursEnabled: true,
        businessHours: d.business_hours ?? {},
        afterHoursMessage: d.after_hours_message ?? FALLBACK_MESSAGE,
        timezone: d.timezone ?? 'America/Chicago',
      }
    : null

  const businessProfile =
    d.business_profile && Object.keys(d.business_profile).length > 0 ? d.business_profile : null

  const rawKb = (kbResult.data ?? []) as Array<{
    file_name: string
    extracted_text: string | null
  }>
  const kbFiles = rawKb.filter(
    (f): f is { file_name: string; extracted_text: string } =>
      typeof f.extracted_text === 'string' && f.extracted_text.length > 0
  )

  return {
    afterHoursConfig,
    businessProfile,
    kbFiles: kbFiles.length > 0 ? kbFiles : null,
  }
} catch {
  return FALLBACK
}
```

- [ ] **Step 6.6: Update prewarmGemini call site**

Find the `createGeminiLiveSession` call in `prewarmGemini` (around line 357). Currently ends with `businessProfile`. Add `kbFiles`:

```typescript
const session = await createGeminiLiveSession(
  tenantId,
  safeVertical,
  safeName,
  callControlId,
  product,
  contextSuffix,
  callerContext.contactId ?? null,
  afterHoursPrefix,
  businessProfile,
  locationConfig.kbFiles
)
```

Also update the destructuring line above it. Currently:

```typescript
const { afterHoursConfig, businessProfile } = locationConfig
```

Change to:

```typescript
const { afterHoursConfig, businessProfile } = locationConfig
```

(No change needed — `locationConfig.kbFiles` is accessed directly on the object in the call site, not destructured.)

- [ ] **Step 6.7: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep "error TS" | grep -v "node_modules" | head -20
```

Expected: 0 errors.

- [ ] **Step 6.8: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add apps/api/src/voice/gemini-live.ts apps/api/src/voice/telnyx-handler.ts && git commit -m "feat(voice): inject KB files block into Gemini system prompt"
```

---

## Task 7: KnowledgeFilesCard UI + Voice Settings Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/voice/KnowledgeFilesCard.tsx`
- Modify: `apps/web/src/app/(dashboard)/settings/voice/page.tsx`

- [ ] **Step 7.1: Create KnowledgeFilesCard.tsx**

Create `apps/web/src/app/(dashboard)/settings/voice/KnowledgeFilesCard.tsx`:

```typescript
'use client'

import { useState, useEffect, useRef } from 'react'

interface KbFile {
  id: string
  file_name: string
  file_size: number
  status: 'pending' | 'processing' | 'ready' | 'error'
  created_at: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_CLASSES: Record<KbFile['status'], string> = {
  pending: 'bg-amber-50 text-amber-600',
  processing: 'bg-amber-50 text-amber-600',
  ready: 'bg-green-50 text-green-700',
  error: 'bg-red-50 text-red-600',
}

export default function KnowledgeFilesCard({ initialFiles }: { initialFiles: KbFile[] }) {
  const [files, setFiles] = useState<KbFile[]>(initialFiles)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasInFlight = files.some((f) => f.status === 'pending' || f.status === 'processing')

  useEffect(() => {
    if (!hasInFlight) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/maya-kb', { credentials: 'include' })
        if (res.ok) {
          const data = (await res.json()) as { files: KbFile[] }
          setFiles(data.files)
        }
      } catch {
        // silent — keep polling
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [hasInFlight])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are allowed')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File too large (max 10MB)')
      return
    }

    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/maya-kb/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setUploadError(data.error ?? 'Upload failed')
        return
      }
      const data = (await res.json()) as { id: string; file_name: string; status: string }
      setFiles((prev) => [
        {
          id: data.id,
          file_name: data.file_name,
          file_size: file.size,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ])
    } catch {
      setUploadError('Network error')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: string, fileName: string) {
    if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return
    setDeletingId(fileId)
    try {
      const res = await fetch(`/api/maya-kb/${fileId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== fileId))
      }
    } catch {
      // silent
    } finally {
      setDeletingId(null)
    }
  }

  const atMax = files.length >= 5

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 mt-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-ink">Knowledge Files</h2>
        <button
          type="button"
          onClick={() => !atMax && fileInputRef.current?.click()}
          disabled={uploading || atMax}
          title={atMax ? 'Maximum 5 files reached' : undefined}
          className="px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      <p className="text-xs text-ink4 mb-4">
        Upload PDF documents (max 5, 10 MB each). Maya extracts their text and uses it on calls.
      </p>

      {uploadError && (
        <div className="mb-3 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
          {uploadError}
        </div>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-ink4">No files uploaded yet.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between py-2 px-3 bg-bg rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-ink truncate max-w-[200px]">{f.file_name}</span>
                <span className="text-xs text-ink4 shrink-0">{formatBytes(f.file_size)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${STATUS_CLASSES[f.status]}`}
                >
                  {f.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(f.id, f.file_name)}
                disabled={deletingId === f.id}
                title="Delete"
                className="ml-3 text-ink4 hover:text-red-500 transition-colors shrink-0 disabled:opacity-40"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7.2: Modify voice settings page.tsx to fetch kb files and render card**

Open `apps/web/src/app/(dashboard)/settings/voice/page.tsx`. Make the following changes:

**Add import** at the top (after the existing imports):

```typescript
import KnowledgeFilesCard from './KnowledgeFilesCard'
```

**Add the kb files query** inside `VoiceSettingsPage`, right before the `return` statement:

```typescript
const { data: kbFiles } = await supabase
  .from('maya_kb_files')
  .select('id, file_name, file_size, status, created_at')
  .eq('tenant_id', tenantId)
  .order('created_at', { ascending: false })
```

**Render `KnowledgeFilesCard`** after `<VoiceSettingsForm settings={settings} />`:

```typescript
      <KnowledgeFilesCard initialFiles={kbFiles ?? []} />
```

The full return block should look like:

```typescript
  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Voice AI Settings</h1>
        <p className="text-sm text-ink3 mt-0.5">Configure how Maya handles your calls</p>
      </div>

      <TestMayaPanel />
      <VoiceSettingsForm settings={settings} />
      <KnowledgeFilesCard initialFiles={kbFiles ?? []} />
    </div>
  )
```

- [ ] **Step 7.3: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -v "node_modules" | grep "error" | head -20
```

Expected: 0 errors.

- [ ] **Step 7.4: Commit**

```bash
cd ~/Documents/Nuatis/nuatis && git add "apps/web/src/app/(dashboard)/settings/voice/KnowledgeFilesCard.tsx" "apps/web/src/app/(dashboard)/settings/voice/page.tsx" && git commit -m "feat(web): add KnowledgeFilesCard to Voice AI settings page"
```

---

## Task 8: Full TypeScript Check + Test Suite

**Files:** None — verification pass.

- [ ] **Step 8.1: Full TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit 2>&1 | grep -E "^.*error TS" | grep -v "node_modules" | head -30
```

Expected: 0 errors.

- [ ] **Step 8.2: Run full test suite**

```bash
cd ~/Documents/Nuatis/nuatis && npm test 2>&1 | tail -30
```

Expected: all tests pass, including `maya-kb-extractor.test.ts` (3 new tests). The pre-existing `voice-pipeline.integration.test.ts` failure (Babel parse error on `as any`) is unrelated to G2 — ignore it if present.

- [ ] **Step 8.3: Report results**

Record TypeScript error count and test pass/fail summary.

---

## Self-Review Checklist

- [x] **Migration**: `0083_maya_kb_files.sql` — table + index + constraints — Task 2
- [x] **Storage bucket**: auto-create `maya-kb` on first upload with "already exists" guard — Task 3
- [x] **POST /api/maya-kb/upload**: multer memoryStorage, PDF-only filter, 10MB limit, Storage upload, DB insert, fire-and-forget extraction — Task 3
- [x] **GET /api/maya-kb**: list files for tenant ordered by created_at desc — Task 3
- [x] **DELETE /api/maya-kb/:id**: tenant ownership verified, storage object removed, DB row deleted — Task 3
- [x] **extractPdfText**: marks processing, downloads from Storage, Gemini `inlineData` with `application/pdf`, updates ready/error — Task 4
- [x] **buildKbFilesBlock**: skips null/empty extracted_text, wraps in `--- UPLOADED DOCUMENTS ---` delimiters — Task 5
- [x] **Tests**: 3 tests in `maya-kb-extractor.test.ts` for empty, null, and 2-file cases — Task 5
- [x] **gemini-live.ts**: `kbFiles` as 10th param, injects block after business profile, before BOOKING_CONTRACT — Task 6
- [x] **telnyx-handler.ts**: `LocationConfig.kbFiles`, parallel query inside `getLocationConfig`, passes to `createGeminiLiveSession` — Task 6
- [x] **MayaKbFile type**: added to `packages/shared/src/types/index.ts` — Task 1
- [x] **KnowledgeFilesCard**: file list with status badges, upload (PDF-only, 10MB), delete with confirm, 5s polling when in-flight, max-5 guard on button — Task 7
- [x] **voice/page.tsx**: fetches kb files server-side, passes to KnowledgeFilesCard — Task 7
- [x] **Max 5 files**: `atMax = files.length >= 5` disables button with tooltip — Task 7
- [x] **Polling stop**: `hasInFlight` derived from status; effect deps on it so interval clears when all files settle — Task 7
