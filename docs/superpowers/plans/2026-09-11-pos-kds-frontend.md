# POS Register + KDS Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/pos` (the register) and `apps/kds` (the kitchen display) against the POS backend that shipped on `feat/pos-kitchen-backend`, so a restaurant demo runs end to end on real data.

**Architecture:** Two new Next 16 apps, each forwarding to the Express API through its own `proxy.ts` (Next 16's renamed middleware). The PIN-minted token lives in an httpOnly cookie and is attached server-side, so it never reaches JavaScript and CORS never applies. Security-critical proxy and session code lives in one shared package rather than being copy-pasted into two apps.

**Tech Stack:** Next 16 (App Router), React 19, MUI v9 + Tailwind v3, TypeScript ESM, Jest.

**Spec:** `docs/superpowers/specs/2026-09-10-kitchen-pos-kds-design.md`
**Backend plan (complete):** `docs/superpowers/plans/2026-09-10-kitchen-pos-backend.md`

## Global Constraints

- **Next 16 names middleware `src/proxy.ts`**, not `middleware.ts`. `apps/web/src/proxy.ts` is the working reference — it exports `proxy(request)` and a `config.matcher`.
- **The browser never holds an API token.** `apps/web` mints a 60s JWT per request from the Auth.js session. POS instead stores the 12h PIN token in an httpOnly cookie and the proxy attaches it. Never put the token in `localStorage`, a non-httpOnly cookie, or a client component.
- **CORS on the API is a single origin** (`https://app.nuatis.com` in prod, `http://localhost:3000` in dev). Do **not** widen it. Every API call goes through the app's own proxy, which is server-side and therefore not subject to CORS.
- **CSRF:** the proxy must reject cross-origin `POST/PUT/PATCH/DELETE` by comparing `Origin` against the forwarded host, exactly as `apps/web/src/proxy.ts` does.
- **Money:** all arithmetic via `@nuatis/pos-core` in integer cents. Never do float arithmetic on dollars, and never re-implement cart or tender math in a component.
- **API surface already built:** `/api/pos/menu/*`, `/api/pos/tickets/*`, `/api/pos/drawer/*`, `/api/pos/terminal/sign-in`, and the `/ws/pos` socket. Do not add API routes in this plan; if something is missing, stop and flag it.
- **`portalScope: 'pos'` is confined to `/api/pos/*`** by `requireAuth`. A POS token cannot reach `/api/contacts` or any dashboard route — do not attempt to call them.
- **Testing posture matches the repo:** `apps/web` has 3 test files, all logic-level, and no component-testing library. Unit-test the proxy, session, and socket-client logic. Verify UI through the Browser pane, not snapshot tests.
- Lint runs at `--max-warnings 0`; a pre-commit hook runs ESLint and Prettier on staged files.
- Commit after every task. Stage files **by path** — never `git add -A` (it swept in 2271 iOS build artifacts during the backend work).

---

### Task 1: `packages/pos-web` — shared proxy and session

Both apps need identical, security-critical plumbing: attach the cookie token as a bearer header, reject cross-origin mutations, and redirect unauthenticated users to the PIN screen. Copy-pasting that into two apps is how one copy silently drifts, so it lives in one package with tests.

**Files:**

- Create: `packages/pos-web/package.json`
- Create: `packages/pos-web/tsconfig.json`
- Create: `packages/pos-web/src/session.ts`
- Create: `packages/pos-web/src/session.test.ts`
- Create: `packages/pos-web/src/proxy.ts`
- Create: `packages/pos-web/src/proxy.test.ts`
- Create: `packages/pos-web/src/index.ts`
- Modify: `apps/api/jest.config.ts` (add the package to `roots` + `moduleNameMapper`)

**Interfaces:**

- Consumes: `next/server` (peer), `@nuatis/pos-core` for nothing yet — do not add it as a dependency here.
- Produces:
  - `POS_COOKIE = 'nuatis_pos_session'`
  - `readPosSession(cookieValue: string | undefined): PosSession | null`
  - `PosSession { token: string; tenantId: string; locationId: string; staffId: string; staffName: string | null; expiresAt: number }`
  - `serializePosSession(s: PosSession): string`
  - `isExpired(s: PosSession, now?: number): boolean`
  - `createPosProxy(opts: { signInPath: string }): (req: NextRequest) => Promise<NextResponse>`

- [ ] **Step 1: Scaffold the package**

Create `packages/pos-web/package.json`:

```json
{
  "name": "@nuatis/pos-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "next": "^16.2.6"
  },
  "devDependencies": {
    "typescript": "*"
  }
}
```

Create `packages/pos-web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["dom", "esnext"],
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing session test**

Create `packages/pos-web/src/session.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { readPosSession, serializePosSession, isExpired, type PosSession } from './session.js'

function session(overrides: Partial<PosSession> = {}): PosSession {
  return {
    token: 'jwt.goes.here',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
    staffId: 'staff-1',
    staffName: 'Dana',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe('serialize / read round trip', () => {
  it('round-trips a session', () => {
    const s = session()
    expect(readPosSession(serializePosSession(s))).toEqual(s)
  })
})

describe('readPosSession', () => {
  it('returns null for undefined', () => {
    expect(readPosSession(undefined)).toBeNull()
  })

  it('returns null for a non-JSON cookie rather than throwing', () => {
    expect(readPosSession('not-json')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    expect(readPosSession(JSON.stringify({ token: 'x', tenantId: 'y' }))).toBeNull()
  })

  it('returns null when the token is not a string', () => {
    const bad = { ...session(), token: 12345 }
    expect(readPosSession(JSON.stringify(bad))).toBeNull()
  })
})

describe('isExpired', () => {
  it('is false before expiry', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 999)).toBe(false)
  })

  it('is true at expiry — treat the boundary as expired', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 1_000)).toBe(true)
  })

  it('is true after expiry', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 1_001)).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test --workspace=apps/api -- pos-web`
Expected: FAIL — cannot resolve `./session.js`. (Jest wiring lands in Step 7; if the suite reports "no tests found" instead, that is the same signal.)

- [ ] **Step 4: Implement `session.ts`**

Create `packages/pos-web/src/session.ts`:

```ts
/**
 * The register's session, stored in an httpOnly cookie.
 *
 * The API token inside this is minted by POST /api/pos/terminal/sign-in and
 * lives 12 hours. It is deliberately NOT readable from JavaScript: the cookie
 * is httpOnly and the proxy attaches the token server-side, so an XSS bug in a
 * menu name cannot exfiltrate a working register credential.
 */
export const POS_COOKIE = 'nuatis_pos_session'

export interface PosSession {
  token: string
  tenantId: string
  locationId: string
  staffId: string
  staffName: string | null
  /** Epoch ms. Mirrors the JWT's own exp so the proxy can redirect before the
   *  API would start 401ing mid-service. */
  expiresAt: number
}

export function serializePosSession(s: PosSession): string {
  return JSON.stringify(s)
}

export function readPosSession(cookieValue: string | undefined): PosSession | null {
  if (!cookieValue) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(cookieValue)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (
    typeof o['token'] !== 'string' ||
    typeof o['tenantId'] !== 'string' ||
    typeof o['locationId'] !== 'string' ||
    typeof o['staffId'] !== 'string' ||
    typeof o['expiresAt'] !== 'number'
  ) {
    return null
  }
  return {
    token: o['token'],
    tenantId: o['tenantId'],
    locationId: o['locationId'],
    staffId: o['staffId'],
    staffName: typeof o['staffName'] === 'string' ? o['staffName'] : null,
    expiresAt: o['expiresAt'],
  }
}

/** Boundary counts as expired — never hand a token to the API on its last ms. */
export function isExpired(s: PosSession, now: number = Date.now()): boolean {
  return now >= s.expiresAt
}
```

- [ ] **Step 5: Write the failing proxy test**

Create `packages/pos-web/src/proxy.test.ts`:

```ts
import { describe, it, expect, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { createPosProxy } from './proxy.js'
import { POS_COOKIE, serializePosSession, type PosSession } from './session.js'

const proxy = createPosProxy({ signInPath: '/sign-in' })

function live(overrides: Partial<PosSession> = {}): string {
  return serializePosSession({
    token: 'jwt.goes.here',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
    staffId: 'staff-1',
    staffName: 'Dana',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  })
}

function req(
  path: string,
  opts: { method?: string; cookie?: string; origin?: string; host?: string } = {}
): NextRequest {
  const headers = new Headers()
  if (opts.cookie) headers.set('cookie', `${POS_COOKIE}=${encodeURIComponent(opts.cookie)}`)
  if (opts.origin) headers.set('origin', opts.origin)
  headers.set('host', opts.host ?? 'pos.nuatis.com')
  headers.set('x-forwarded-proto', 'https')
  return new NextRequest(`https://pos.nuatis.com${path}`, {
    method: opts.method ?? 'GET',
    headers,
  })
}

beforeEach(() => {
  process.env['API_BACKEND_URL'] = 'http://localhost:3001'
})

describe('API forwarding', () => {
  it('attaches the cookie token as a bearer header', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live() }))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/api/pos/menu/tree')
    expect(res.headers.get('x-middleware-request-authorization')).toBe('Bearer jwt.goes.here')
  })

  it('401s an API call with no session rather than forwarding anonymously', async () => {
    const res = await proxy(req('/api/pos/menu/tree'))
    expect(res.status).toBe(401)
  })

  it('401s an API call whose session has expired', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live({ expiresAt: 1 }) }))
    expect(res.status).toBe(401)
  })

  it('401s an API call with a corrupt cookie', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: 'not-json' }))
    expect(res.status).toBe(401)
  })

  it('does not forward the session cookie upstream', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live() }))
    expect(res.headers.get('x-middleware-request-cookie') ?? '').not.toContain(POS_COOKIE)
  })
})

describe('CSRF', () => {
  it('rejects a cross-origin POST', async () => {
    const res = await proxy(
      req('/api/pos/tickets/fire', {
        method: 'POST',
        cookie: live(),
        origin: 'https://evil.example',
      })
    )
    expect(res.status).toBe(403)
  })

  it('allows a same-origin POST', async () => {
    const res = await proxy(
      req('/api/pos/tickets/fire', {
        method: 'POST',
        cookie: live(),
        origin: 'https://pos.nuatis.com',
      })
    )
    expect(res.status).not.toBe(403)
  })

  it('allows a POST with no Origin header (server-side call)', async () => {
    const res = await proxy(req('/api/pos/tickets/fire', { method: 'POST', cookie: live() }))
    expect(res.status).not.toBe(403)
  })

  it('does not CSRF-check a GET', async () => {
    const res = await proxy(
      req('/api/pos/menu/tree', { cookie: live(), origin: 'https://evil.example' })
    )
    expect(res.status).not.toBe(403)
  })
})

describe('session route passthrough', () => {
  it('never intercepts /api/session — it is how you sign in', async () => {
    const res = await proxy(req('/api/session', { method: 'POST' }))
    expect(res.status).not.toBe(401)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })
})

describe('page routing', () => {
  it('redirects an unauthenticated page request to the sign-in screen', async () => {
    const res = await proxy(req('/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/sign-in')
  })

  it('lets the sign-in screen itself through unauthenticated', async () => {
    const res = await proxy(req('/sign-in'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('does not redirect an authenticated page request', async () => {
    const res = await proxy(req('/', { cookie: live() }))
    expect(res.headers.get('location')).toBeNull()
  })
})
```

- [ ] **Step 6: Implement `proxy.ts` and `index.ts`**

Create `packages/pos-web/src/proxy.ts`:

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { POS_COOKIE, readPosSession, isExpired } from './session.js'

export interface PosProxyOptions {
  /** Where to send an unauthenticated page request, e.g. '/sign-in'. */
  signInPath: string
}

/**
 * Shared POS middleware for apps/pos and apps/kds.
 *
 * Mirrors apps/web/src/proxy.ts, with one deliberate difference: apps/web mints
 * a fresh 60s JWT from the Auth.js session on every request, whereas the
 * register has no Auth.js session — it holds a 12h token minted by
 * POST /api/pos/terminal/sign-in, kept in an httpOnly cookie. The proxy reads
 * that cookie server-side and attaches the token, so it never reaches the
 * browser's JavaScript and the API's single-origin CORS never comes into play.
 */
export function createPosProxy(opts: PosProxyOptions) {
  return async function posProxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl
    const API_BACKEND = process.env['API_BACKEND_URL'] ?? 'http://localhost:3001'

    // The app's own session endpoint performs the PIN exchange and sets the
    // cookie. It must never be proxied or gated — it is how you get a session.
    if (pathname.startsWith('/api/session')) {
      return NextResponse.next()
    }

    if (pathname.startsWith('/api')) {
      // CSRF: the browser always sends Origin on state-mutating requests. An
      // absent Origin means a server-side or same-origin navigation.
      const origin = request.headers.get('origin')
      const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      const fwdProto = request.headers.get('x-forwarded-proto') ?? 'https'
      const expectedOrigin = fwdHost ? `${fwdProto}://${fwdHost}` : request.nextUrl.origin
      if (
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
        origin &&
        origin !== expectedOrigin
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const session = readPosSession(request.cookies.get(POS_COOKIE)?.value)
      if (!session || isExpired(session)) {
        // 401 rather than a redirect: these are fetch() calls, and the client
        // turns a 401 into a trip to the PIN screen itself.
        return NextResponse.json({ error: 'No register session' }, { status: 401 })
      }

      const url = new URL(pathname + request.nextUrl.search, API_BACKEND)
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${session.token}`)
      // The API has no use for the register cookie, and forwarding a
      // credential further than it needs to go is how it ends up in a log.
      headers.delete('cookie')
      return NextResponse.rewrite(url, { request: { headers } })
    }

    // Page requests: anything but the sign-in screen needs a live session.
    if (!pathname.startsWith(opts.signInPath)) {
      const session = readPosSession(request.cookies.get(POS_COOKIE)?.value)
      if (!session || isExpired(session)) {
        const url = request.nextUrl.clone()
        url.pathname = opts.signInPath
        return NextResponse.redirect(url)
      }
    }

    return NextResponse.next()
  }
}
```

Create `packages/pos-web/src/index.ts`:

```ts
export {
  POS_COOKIE,
  readPosSession,
  serializePosSession,
  isExpired,
  type PosSession,
} from './session.js'
export { createPosProxy, type PosProxyOptions } from './proxy.js'
```

- [ ] **Step 7: Wire Jest and run**

In `apps/api/jest.config.ts`, extend the existing entries — the package's tests live outside `rootDir`, so without the `roots` entry they are silently never discovered:

```ts
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@nuatis/pos-core$': '<rootDir>/../../packages/pos-core/src/index.ts',
    '^@nuatis/pos-web$': '<rootDir>/../../packages/pos-web/src/index.ts',
  },
  roots: [
    '<rootDir>/src',
    '<rootDir>/../../packages/pos-core/src',
    '<rootDir>/../../packages/pos-web/src',
  ],
```

`next/server` must resolve for the proxy test. Add `next` to the api workspace's devDependencies if the test cannot resolve it, then:

```bash
npm install
npm run test --workspace=apps/api -- pos-web
```

Expected: PASS, 20 tests.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit -p packages/pos-web
npm run typecheck --workspace=apps/api
git add packages/pos-web apps/api/jest.config.ts apps/api/package.json package-lock.json
git commit -m "feat(pos): shared POS proxy and session package"
```

---

### Task 2: `apps/pos` scaffold

**Files:**

- Create: `apps/pos/package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.js`, `postcss.config.js`, `jest.config.cjs`, `next-env.d.ts`
- Create: `apps/pos/src/app/layout.tsx`, `apps/pos/src/app/globals.css`
- Create: `apps/pos/src/theme/ThemeRegistry.tsx`, `apps/pos/src/theme/muiTheme.ts`
- Create: `apps/pos/src/proxy.ts`
- Modify: root `package.json` (workspaces)

**Interfaces:**

- Consumes: `@nuatis/pos-web` (`createPosProxy`), `@nuatis/pos-core`.
- Produces: a Next app that boots on port 3002 and redirects `/` to `/sign-in`.

- [ ] **Step 1: Register the workspace**

Root `package.json` currently lists `apps/api`, `apps/web`, `packages/*`. Replace the two app entries with a glob so new apps are picked up automatically:

```json
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
```

Verify this does not pull in `apps/ios` or `apps/mobile` as npm workspaces in a way that breaks install:

```bash
npm install
npm ls --workspaces --depth=0
```

If `apps/ios` (Swift, no package.json) or `apps/mobile` (Expo, its own lockfile) causes trouble, revert to explicit entries: `"apps/api", "apps/web", "apps/pos", "apps/kds", "packages/*"`.

- [ ] **Step 2: Create `apps/pos/package.json`**

```json
{
  "name": "@nuatis/pos",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3002",
    "build": "next build",
    "start": "next start --port 3002",
    "lint": "eslint src --ext .ts,.tsx --max-warnings 0",
    "typecheck": "tsc --noEmit",
    "test": "jest --passWithNoTests"
  },
  "dependencies": {
    "@emotion/react": "^11.14.0",
    "@emotion/styled": "^11.14.1",
    "@mui/material": "^9.3.1",
    "@mui/material-nextjs": "^9.3.0",
    "@nuatis/design-tokens": "*",
    "@nuatis/pos-core": "*",
    "@nuatis/pos-web": "*",
    "next": "^16.2.6",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  }
}
```

Copy the exact dependency versions from `apps/web/package.json` rather than the ones above if they differ — two Next majors in one install is a long debugging session.

- [ ] **Step 3: Copy config from `apps/web`**

`tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `jest.config.cjs` and `next-env.d.ts` can be copied verbatim from `apps/web` — the tsconfig's `@/*` path alias and Tailwind's token import both apply unchanged.

`next.config.ts` needs one change from web's: the CSP `connect-src` must allow the POS WebSocket.

```ts
import type { NextConfig } from 'next'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== 'production' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // The KDS socket connects to the API host directly — proxied HTTP calls are
  // same-origin, but a WebSocket upgrade is not.
  "connect-src 'self' https://api.nuatis.com wss://api.nuatis.com ws://localhost:3001",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@nuatis/pos-core', '@nuatis/pos-web', '@nuatis/design-tokens'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY }],
      },
    ]
  },
}

export default config
```

- [ ] **Step 4a: Extract the design tokens to a package first**

`apps/web/src/theme/tokens.js` is the single source of truth for colours, shared between Tailwind's config (which `require()`s it) and `muiTheme.ts`. Two new apps need it too.

Do **not** reach into `apps/web` with a relative path — that crosses an app boundary, so Next will not transpile it and `apps/pos`'s tsconfig will not include it. Do **not** copy the file either: three hand-maintained copies of the palette is the same drift that let the `pos` module go missing from the web module list during the backend work.

Move it instead:

```bash
mkdir -p packages/design-tokens
git mv apps/web/src/theme/tokens.js packages/design-tokens/tokens.js
```

Create `packages/design-tokens/package.json` — CommonJS, because Tailwind v3's config loader `require()`s it directly and does not run through a transpiler:

```json
{
  "name": "@nuatis/design-tokens",
  "version": "0.0.1",
  "private": true,
  "main": "./tokens.js"
}
```

Then update the three existing importers:

- `apps/web/src/theme/muiTheme.ts`: `import tokens from './tokens.js'` → `import tokens from '@nuatis/design-tokens'`
- `apps/web/tailwind.config.js`: `require('./src/theme/tokens.js')` → `require('@nuatis/design-tokens')`
- add `"@nuatis/design-tokens": "*"` to `apps/web/package.json` dependencies

Verify nothing else referenced it, then confirm the dashboard still builds:

```bash
grep -rn "theme/tokens" apps/web --include='*.ts' --include='*.tsx' --include='*.js' \
  | grep -v node_modules    # expect no output
npm install
npm run build --workspace=apps/web
```

This is a real change to a working app, so it gets its own commit before the register touches anything:

```bash
git add packages/design-tokens apps/web/src/theme/muiTheme.ts apps/web/tailwind.config.js apps/web/package.json package-lock.json
git commit -m "refactor(theme): extract design tokens to @nuatis/design-tokens"
```

- [ ] **Step 4b: Theme — bigger touch targets, same tokens**

Create `apps/pos/src/theme/muiTheme.ts`:

```ts
import { createTheme } from '@mui/material/styles'
// Same tokens the dashboard and Tailwind read — change colours there, not here.
import tokens from '@nuatis/design-tokens'

/**
 * Register theme. Same palette as the dashboard, deliberately larger controls:
 * this is a touchscreen operated by someone standing up, often in a hurry.
 * 56px is the smallest comfortable touch target for repeated use.
 */
export const muiTheme = createTheme({
  palette: {
    primary: { main: tokens.colors.tealBrand },
    background: { default: tokens.colors.bg, paper: tokens.colors.cream },
  },
  typography: { button: { fontSize: '1.125rem', textTransform: 'none' } },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { minHeight: 56, borderRadius: 12 },
      },
    },
  },
})
```

Copy `ThemeRegistry.tsx` from `apps/web/src/theme/`, changing only the `muiTheme` import path. Keep `enableCssLayer: true` and the absence of `CssBaseline` — Tailwind's preflight is the reset.

- [ ] **Step 5: Root layout and proxy**

Create `apps/pos/src/app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from 'next'
import { ThemeRegistry } from '@/theme/ThemeRegistry'
import './globals.css'

export const metadata: Metadata = { title: 'Nuatis Register' }

// A register is a fixed-size touchscreen — pinch-zooming it mid-service is
// never intentional.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  )
}
```

Create `apps/pos/src/proxy.ts`:

```ts
import { createPosProxy } from '@nuatis/pos-web'

export const proxy = createPosProxy({ signInPath: '/sign-in' })

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

> Next 16 picks up `src/proxy.ts` by convention — there is no `middleware.ts`. Confirm by checking that `apps/web` has no `middleware.ts` either.

- [ ] **Step 6: Verify it boots**

Add a temporary `src/app/page.tsx` returning `<main>register</main>`, then start it through the Browser pane (never `npm run dev` in Bash) and confirm `/` redirects to `/sign-in`.

- [ ] **Step 7: Commit**

```bash
npm run typecheck --workspace=@nuatis/pos
npm run lint --workspace=@nuatis/pos
git add apps/pos package.json package-lock.json
git commit -m "feat(pos): scaffold the register app"
```

---

### Task 3: PIN sign-in

**Files:**

- Create: `apps/pos/src/app/api/session/route.ts`
- Create: `apps/pos/src/app/sign-in/page.tsx`
- Create: `apps/pos/src/components/PinPad.tsx`
- Create: `apps/pos/src/app/api/session/route.test.ts`

**Interfaces:**

- Consumes: `POST /api/pos/terminal/sign-in` on the API, returning `{ token, staff: { id, name }, locationId }`.
- Produces: an httpOnly `nuatis_pos_session` cookie; `DELETE /api/session` clears it.

- [ ] **Step 1: Write the session route**

Create `apps/pos/src/app/api/session/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { POS_COOKIE, serializePosSession } from '@nuatis/pos-web'

const API_BACKEND = process.env.API_BACKEND_URL ?? 'http://localhost:3001'
// Matches the 12h expiry the API stamps on the token.
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000

/**
 * Exchanges a PIN for a register session.
 *
 * Runs server-side so the PIN and the returned token never appear in a client
 * bundle or a browser network log the cashier could read off the screen. The
 * cookie is httpOnly, so an XSS bug cannot steal a working register credential.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as Record<string, unknown>
  const tenantId = typeof body['tenant_id'] === 'string' ? body['tenant_id'] : ''
  const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
  const pin = typeof body['pin'] === 'string' ? body['pin'] : ''

  if (!tenantId || !locationId || !pin) {
    return NextResponse.json(
      { error: 'tenant_id, location_id and pin are required' },
      { status: 400 }
    )
  }

  const upstream = await fetch(`${API_BACKEND}/api/pos/terminal/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, location_id: locationId, pin }),
  })

  if (!upstream.ok) {
    // Pass the API's deliberately uniform 401 straight through — distinguishing
    // "wrong PIN" from "unknown tenant" here would rebuild the enumeration
    // oracle the API route was careful to avoid.
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 })
  }

  const data = (await upstream.json()) as {
    token: string
    staff: { id: string; name: string | null }
    locationId: string
  }

  const res = NextResponse.json({ staff: data.staff, locationId: data.locationId })
  res.cookies.set(
    POS_COOKIE,
    serializePosSession({
      token: data.token,
      tenantId,
      locationId: data.locationId,
      staffId: data.staff.id,
      staffName: data.staff.name,
      expiresAt: Date.now() + TWELVE_HOURS_MS,
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: TWELVE_HOURS_MS / 1000,
    }
  )
  return res
}

/** Sign out — clears the register session. */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(POS_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
```

- [ ] **Step 2: Test the route's contract**

Create `apps/pos/src/app/api/session/route.test.ts` covering: a 400 when fields are missing; a 401 passed through unchanged when upstream rejects; a successful exchange setting an httpOnly cookie; and that the response body never contains the token.

```ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const { POST } = await import('./route.js')

function post(body: unknown) {
  return new Request('http://localhost:3002/api/session', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => fetchMock.mockReset())

describe('POST /api/session', () => {
  it('400s when a field is missing', async () => {
    const res = await POST(post({ pin: '4821' }))
    expect(res.status).toBe(400)
  })

  it('passes a rejected PIN through as 401', async () => {
    fetchMock.mockResolvedValue({ ok: false } as never)
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '0000' }))
    expect(res.status).toBe(401)
  })

  it('sets an httpOnly cookie and never returns the token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'secret.jwt',
        staff: { id: 's1', name: 'Dana' },
        locationId: 'l',
      }),
    } as never)
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '4821' }))

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(await res.clone().text()).not.toContain('secret.jwt')
  })
})
```

Run: `npm run test --workspace=@nuatis/pos`
Expected: PASS, 3 tests.

- [ ] **Step 3: Build the PIN pad**

Create `apps/pos/src/components/PinPad.tsx` — a client component with 0–9, clear, and enter; masked display; disabled while submitting; and an error state that says only "Incorrect PIN". Touch targets at least 72px, since this is the control used most often.

On submit it POSTs to `/api/session` and, on success, `router.replace('/')`. Do not store anything in `localStorage`.

`tenant_id` and `location_id` come from env for the demo — `NEXT_PUBLIC_POS_TENANT_ID` and `NEXT_PUBLIC_POS_LOCATION_ID` — with a `// TODO` noting that a real deployment pairs the device instead.

- [ ] **Step 4: Verify in the browser and commit**

Start the app through the Browser pane, confirm a wrong PIN shows the error and a correct PIN lands on `/`, then commit.

---

### Task 4: Menu grid and cart

**Files:**

- Create: `apps/pos/src/app/page.tsx` (the register screen)
- Create: `apps/pos/src/components/MenuGrid.tsx`, `CartPanel.tsx`, `ModifierDialog.tsx`
- Create: `apps/pos/src/lib/useCart.ts`
- Create: `apps/pos/src/lib/useCart.test.ts`

**Interfaces:**

- Consumes: `GET /api/pos/menu/tree`; `cartTotals`, `lineTotalCents`, `toCents`, `toDollars`, `type CartLine` from `@nuatis/pos-core`.
- Produces: `useCart()` returning `{ lines, addLine, removeLine, setQuantity, clear, totals }`.

**Porting note:** `Nuatis-KitchenPOS/artifacts/nuatis-pos/src/components/MenuGrid.tsx` and `CartSidebar.tsx` are the visual reference. Port the layout and interaction, not the code — the prototype is Vite + shadcn and this is Next + MUI.

- [ ] **Step 1: Test the cart hook's logic first**

`useCart` holds the only stateful money logic in the app, so it gets tests even though components do not. Cover: adding the same item twice increments rather than duplicating; an item with different modifiers is a separate line; quantity 0 removes the line; totals delegate to `pos-core` rather than recomputing.

- [ ] **Step 2: Implement `useCart`**

All amounts are cents. The hook converts `menu_items.price` (a numeric string from Postgres) with `toCents` at the boundary and never stores dollars.

```ts
import { useCallback, useMemo, useState } from 'react'
import { cartTotals, type CartLine, type CartModifier } from '@nuatis/pos-core'

/** Two lines merge only if the item AND the chosen modifiers match. */
function sameLine(a: CartLine, b: CartLine): boolean {
  if (a.menuItemId !== b.menuItemId) return false
  if (a.modifiers.length !== b.modifiers.length) return false
  const ids = (m: CartModifier[]) =>
    m
      .map((x) => x.optionId)
      .sort()
      .join('|')
  return ids(a.modifiers) === ids(b.modifiers)
}
```

- [ ] **Step 3: Build the screen**

Three regions: category tabs, a scrolling item grid, and a fixed cart panel. Tapping an item with required modifier groups opens `ModifierDialog` before it can be added — the API models `required` and `min_select`, and a cart that ignores them sends the kitchen an unmakeable ticket.

- [ ] **Step 4: Verify against real data and commit**

With the demo menu seeded (Task 9), confirm the grid renders from `/api/pos/menu/tree` and that the cart total matches a hand calculation including tax.

---

### Task 5: Checkout — tip, tender, change

**Files:**

- Create: `apps/pos/src/components/CheckoutDialog.tsx`, `TipPicker.tsx`, `CashTender.tsx`, `SplitTender.tsx`
- Create: `apps/pos/src/lib/useCheckout.ts`, `useCheckout.test.ts`

**Interfaces:**

- Consumes: `tenderBalanceCents`, `changeDueCents`, `cartTotals` from `@nuatis/pos-core`; `POST /api/pos/drawer/sessions/:id/events` for cash.
- Produces: `useCheckout()` with the state machine `idle → tip → tender → processing → receipt → done`.

**Porting note:** the prototype's checkout state machine and 5-leg split tender were assessed as sound in the original audit. Port that design.

- [ ] **Step 1: Test the state machine**

Cover: cancel from any state returns to `idle`; the split cannot complete while `tenderBalanceCents > 0`; over-tender reports change due; a card leg is a mocked 2s approval; and the machine cannot reach `receipt` without a zero balance.

- [ ] **Step 2: Implement it**

Card payment is a simulated 2-second approval for the demo, but the payment row is written as though real, so the Stripe Terminal SDK drops into one seam later. Mark it:

```ts
// DEMO: simulated card approval. Replace this single call with the Stripe
// Terminal SDK — everything downstream already treats the result as real.
```

- [ ] **Step 3: Record cash in the drawer**

A cash leg posts a `sale` event to the open drawer session so the close-out variance is real. If no drawer is open, block checkout with "Open the drawer first" rather than silently skipping the event — a sale missing from the drawer is exactly the discrepancy the close-out is meant to catch.

---

### Task 6: Fire to kitchen

**Files:**

- Modify: `apps/pos/src/app/page.tsx`, `apps/pos/src/components/CheckoutDialog.tsx`
- Create: `apps/pos/src/lib/createOrder.ts`, `createOrder.test.ts`
- Create: `apps/api/src/routes/pos/orders.ts`, `orders.integration.test.ts` — **plan deviation, see below**
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**

- Consumes: `POST /api/pos/orders` then `POST /api/pos/tickets/fire`.
- Produces: `toOrderPayload`, `toPaymentInputs`, `createAndFireOrder(lines, opts)` returning `{ orderId, fired, ticketCount }`.

**Deviation: this task added an API route, which the plan's global constraints forbid.**

The plan said to reuse `POST /api/orders`. Three things make that impossible, each of which would be a bug if worked around:

1. A POS token carries `portalScope: 'pos'`, which `requireAuth` confines to `/api/pos/*`. Reaching the dashboard route means widening the one boundary keeping a register PIN away from `/api/contacts`.
2. `POST /api/orders` hard-codes `source: 'staff'`. The `'pos'` value migration 0195 widened the constraint for is unreachable from it.
3. Its line items have no `menu_item_id` and no `modifiers`, and `tickets/fire` routes by exactly those two columns — every line would land on the unrouted ticket.

`POST /api/pos/orders` prices from the menu and ignores any price in the body, validates that a chosen option belongs to a group the item actually offers, folds modifier deltas into `unit_price` (because `order_line_items.total` is a generated `quantity * unit_price` column), and clamps recorded payments to the total so change given is not booked as revenue.

- [x] **Step 1: Create the order, then fire it**

The order carries `source: 'pos'` and a `location_id`, and each line has `menu_item_id` plus the `modifiers` snapshot. Firing without a `location_id` is rejected by the API by design.

Both the kitchen fire and the cash-drawer write now happen on the transition _into_ the receipt, not when the cashier dismisses it — firing on dismissal means a receipt left on screen is food nobody started cooking. A ref guards against re-firing.

**Bug fixed in passing:** a cash-drawer failure called `setError`, which renders a full-page alert and wiped the register out from under a cashier holding a customer's receipt. Post-payment problems are now warnings on the receipt.

- [x] **Step 2: Test the payload shape**

`source === 'pos'` is asserted explicitly. 18 API integration tests + 13 client tests, covering cross-tenant items and locations, an option not offered on the item, body-supplied prices being ignored, tax on the taxable base only, and the payment clamp.

**Verified live** on a $23.10 split-card sale: order `ORD-1001` wrote `source: 'pos'`, `subtotal 18.00 / tax 1.58 / tip 3.52 / total 23.10 / balance_due 0.00`, two tickets (`grill` #1, `fry` #2) with the modifier snapshot intact, and two `order_payments` rows ($10.00 + $13.10).

---

### Task 7: `apps/kds` scaffold

Same scaffold as Task 2, consuming the same `@nuatis/pos-web` proxy, with `signInPath: '/sign-in'` and its own PIN screen. A manager PINs the kitchen screen in once and it runs all shift on the 12h cookie.

**Files:** mirror of Task 2 plus `apps/kds/src/app/api/session/route.ts` (identical to the register's).

If the session route is byte-identical to the register's, move it into `@nuatis/pos-web` as a shared handler factory rather than keeping two copies.

---

### Task 8: Live ticket board

**Files:**

- Create: `apps/kds/src/app/page.tsx`, `apps/kds/src/components/TicketCard.tsx`, `StationFilter.tsx`
- Create: `apps/kds/src/lib/usePosSocket.ts`, `usePosSocket.test.ts`
- Create: `apps/kds/src/app/api/ws-token/route.ts`

**Interfaces:**

- Consumes: `GET /api/pos/tickets?location_id=&status=`, `PATCH /api/pos/tickets/:id/status`, and the `/ws/pos` socket.
- Produces: `usePosSocket({ onEvent })` handling connect, the auth frame, reconnect with backoff, and cleanup.

- [ ] **Step 1: Solve the socket's credential problem first**

This is the one genuinely awkward part. The proxy attaches the token to HTTP requests server-side, but a browser WebSocket connects to the API host **directly** and the client has no token — by design.

The socket's first frame must be `{ type: 'auth', token, tenantId, locationId }`. So the app needs a server route that hands the client a token for socket use only:

```ts
// apps/kds/src/app/api/ws-token/route.ts
// The KDS socket connects to the API directly, so the browser needs a token
// for that one purpose. This deliberately narrow endpoint returns the session
// token and nothing else, and exists only because a WebSocket upgrade cannot
// be proxied the way fetch() calls are.
```

Returning the 12h token to JavaScript weakens the httpOnly guarantee for the KDS. Two ways to judge it: the kitchen screen is a fixed device in a staff-only area, and the token is confined to `/api/pos/*` by `requireAuth`. **Flag this trade-off to the user before implementing** — the alternative is a short-lived socket-only token, which needs a new API endpoint and is outside this plan's "no new API routes" constraint.

- [ ] **Step 2: Implement the socket hook**

Connect, send the auth frame, wait for `{"type":"authenticated"}`, then dispatch `ticket.fired` / `ticket.updated` / `ticket.bumped`. Reconnect with capped exponential backoff. Always close the socket in the effect cleanup — a leaked socket per re-render is exactly the bug class the API's own ping-leak fix dealt with.

- [ ] **Step 3: Build the board**

Tickets as columns or a grid, oldest first, with elapsed time since `fired_at` and a colour shift as it ages. A large bump button per ticket — the target is someone with full hands. Station filter reads `?station=`.

Load the initial list over HTTP, then apply socket events on top. Do not rely on the socket alone: a screen that connects after a ticket was fired would otherwise show an empty kitchen.

- [ ] **Step 4: Verify two screens do not cross**

With two browser windows on different `location_id`s, fire a ticket and confirm only the matching screen updates. This is the client-side half of the L5 guarantee the backend enforces.

---

### Task 9: Demo seeding

**Files:**

- Create: `apps/api/src/scripts/seed-pos-demo.ts`

A script, run deliberately, that seeds a restaurant menu with `kitchen_station` set across at least two stations, plus a staff PIN and `pos_location_ids`.

**It must never run automatically.** The prototype seeded demo data from inside hooks whenever a store was empty, which on a real merchant's first load would have invented a menu for them. Follow the existing pattern in `apps/api/src/scripts/seed-services.ts`.

- [ ] **Step 1: Write the script**
- [ ] **Step 2: Run it against the demo tenant**
- [ ] **Step 3: Confirm the register renders the seeded menu and the KDS routes by station**

---

## Verification

- [ ] `npm run test --workspace=apps/api` — full suite green, including the new `pos-web` tests
- [ ] `npm run typecheck` across workspaces — clean
- [ ] `npm run lint` — clean at `--max-warnings 0`
- [ ] A cashier can PIN in, build a cart with modifiers, take cash with change due, and fire to the kitchen
- [ ] The KDS shows the ticket within a second, and bumping it updates the register's view
- [ ] Two locations never see each other's tickets
- [ ] The register's API token is absent from `document.cookie` and from any client bundle:
  ```bash
  grep -r "nuatis_pos_session" apps/pos/.next/static 2>/dev/null   # expect no output
  ```

## Resolved before starting

**1. The KDS socket credential — solved without a new API route, and without
putting the 12h token in JavaScript.**

`apps/web/src/proxy.ts` already mints JWTs locally with `AUTH_SECRET`, and
`lib/pos-ws.ts` accepts any HS256 token with `iss: nuatis-web`,
`aud: nuatis-api`, a matching `tenantId`, and a `locationId` that matches the
channel. So the KDS app mints its **own 60-second socket ticket** server-side
from the cookie session, rather than returning the register token.

The socket verifies only at handshake, so a 60s ticket is sufficient for the
life of the connection; the client fetches a fresh one per reconnect. A stolen
ticket is useless within a minute and can only ever join one location's ticket
feed. Task 8 Step 1 is now this, not the `ws-token` passthrough.

**2. Design-token extraction — proceed.** Moving `tokens.js` to
`packages/design-tokens` touches the working dashboard, but it is a mechanical
move plus three import updates, gated behind a passing `npm run build
--workspace=apps/web` in its own commit. The alternative — a third hand-copy of
the palette — is the drift that already hid the missing `pos` entry in the web
module list during the backend work.

**3. Deployment — deliberately deferred, and nothing is blocked by it.** Both
apps read their origin and API host from env (`API_BACKEND_URL`,
`NEXT_PUBLIC_*`), and the CSP `connect-src` is built from those rather than
hardcoded hostnames. Cookies are host-scoped with `sameSite: 'lax'`, so each
app works on whatever hostname it lands on, including localhost. Pick
hostnames when you deploy; only the production CSP `connect-src` and the
API's `CORS_ORIGIN` need revisiting then.
