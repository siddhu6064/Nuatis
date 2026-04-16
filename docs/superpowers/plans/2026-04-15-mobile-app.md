# Mobile App (React Native + Expo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a React Native + Expo mobile companion app to Nuatis CRM with dashboard, contacts, appointments, pipeline, push notifications, and offline caching.

**Architecture:** Mobile app consumes existing REST API via Bearer JWT auth. New mobile-login endpoint issues JWTs (reusing Auth.js HS256 with AUTH_SECRET). Mobile push uses Expo Push API with tokens stored in new mobile_push_tokens table. Offline support uses expo-sqlite for read-only cache. StyleSheet-based styling (skip NativeWind to avoid setup overhead).

**Tech Stack:** Expo SDK 50+, expo-router, React Native, expo-sqlite, expo-secure-store, expo-notifications, jose (JWT), expo-server-sdk (API).

**Pragmatic Simplifications (allowed by spec):**

- Use StyleSheet.create() instead of NativeWind (spec allows fallback)
- Offline read-only cache only (skip mutation queue — nice-to-have per spec)
- Skip biometric unlock (optional per spec, adds complexity)
- Placeholder asset files (spec says refine later)

**Key Facts:**

- Latest migration: `0041` → new is `0042`
- Auth uses jose HS256 with AUTH_SECRET env var, already supports Bearer tokens
- No existing mobile-login endpoint, no expo-server-sdk installed
- apps/mobile doesn't exist — create fresh
- Root package.json workspaces: `apps/*`, `packages/*` — mobile automatically included

---

## Task 1: API Changes — Migration + Mobile Login + Dashboard

- Create `supabase/migrations/0042_mobile_push_tokens.sql`
- Add POST /api/auth/mobile-login to new `apps/api/src/routes/auth.ts`
- Add GET /api/dashboard aggregation endpoint to insights.ts (or new route)

## Task 2: API Changes — Push Registration + Expo Push Helper

- Install expo-server-sdk in apps/api
- Create `apps/api/src/lib/expo-push.ts` — sendExpoPush function
- Create `apps/api/src/routes/push-mobile.ts` — register/unregister endpoints
- Update notifyOwner() to also send mobile push

## Task 3: Mobile App Skeleton

- Create apps/mobile/ with package.json, app.json, tsconfig.json, babel.config.js
- Expo dependencies: expo, expo-router, expo-sqlite, expo-secure-store, expo-notifications, react-native
- Create lib/api.ts (fetch wrapper), lib/auth-context.tsx, lib/colors.ts, lib/offline-cache.ts
- Create app/\_layout.tsx (root with auth guard)
- Create app/(auth)/login.tsx
- Placeholder assets in assets/

## Task 4: Mobile App Screens

- app/(tabs)/\_layout.tsx — tab navigator
- app/(tabs)/index.tsx — dashboard
- app/(tabs)/contacts.tsx — contacts list
- app/(tabs)/contacts/[id].tsx — contact detail
- app/(tabs)/appointments.tsx — appointments
- app/(tabs)/pipeline.tsx — pipeline (tap-to-move)
- app/(tabs)/notifications.tsx — notifications inbox
- FAB with quick actions (add contact, log call, create task, send SMS)
- Push notification handler + deep linking

## Task 5: Run Tests & Verify

- npm test — 52/52 passing (mobile has no tests yet)
- Verify npx expo start works (smoke test only — actual simulator not required)
