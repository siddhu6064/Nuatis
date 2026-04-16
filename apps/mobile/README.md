# Nuatis Mobile

React Native + Expo companion app for the Nuatis CRM.

## Requirements

- Node 18+
- Expo CLI: `npm install -g expo-cli`
- iOS: Xcode 15+ (Mac only)
- Android: Android Studio with emulator

## Setup

```bash
cd apps/mobile
npm install
```

## Running

```bash
# Start dev server
npm start

# iOS simulator
npm run ios

# Android emulator
npm run android
```

## Environment

The API URL is set in `app.json` under `expo.extra.apiUrl`. Default: `http://localhost:3001`.

For device testing, replace `localhost` with your machine's LAN IP (e.g. `http://192.168.1.x:3001`).

## Structure

```
app/
  _layout.tsx           Root layout with AuthProvider
  (auth)/
    login.tsx           Login screen
  (tabs)/
    index.tsx           Dashboard (today's appointments, tasks, stats)
    contacts.tsx        Contacts list with search
    contacts/[id].tsx   Contact detail + call/SMS + activity feed
    appointments.tsx    Appointments list with offline cache
    pipeline.tsx        Kanban-style pipeline (horizontal scroll)
    notifications.tsx   Notification history
lib/
  api.ts                API client with auth token injection
  auth-context.tsx      Auth state + login/logout
  colors.ts             Design tokens
  offline-cache.ts      SQLite read-only cache (contacts + appointments)
  push.ts               Push notification registration
assets/                 Placeholder images (replace before production build)
```

## Notes

- Offline cache is read-only (no mutation queue). Stale data shown with "Offline" indicator.
- Placeholder PNG assets in `assets/` must be replaced with real images before submitting to app stores.
- Push notification token registration hits `POST /api/push/mobile/register` on the API.
- Auth uses `POST /api/auth/mobile/login` returning `{ token, user }`.
