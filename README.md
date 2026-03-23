# Nuatis LLC

AI-powered front-office platform for small businesses.

## Stack

- **apps/api** — Express + TypeScript (Node.js backend)
- **apps/web** — Next.js 14 + TypeScript (business dashboard)
- **packages/shared** — Shared TypeScript types (used by api + web)

## Getting started

```bash
# Install all dependencies
npm install

# Run API locally
npm run dev:api

# Run Web locally
npm run dev:web

# Run all tests
npm test

# Typecheck all packages
npm run typecheck
```

## Build phases

| Phase | Focus                                           | Weeks |
| ----- | ----------------------------------------------- | ----- |
| 1     | Foundation — DB, Auth, CRM, Billing             | 1–8   |
| 2     | Voice AI — Telnyx, Deepgram, Claude, ElevenLabs | 9–16  |
| 3     | Automation Engine — BullMQ, RAG, Pipeline       | 17–24 |
| 4     | Scale — Terraform, AWS, E2E, Mobile             | 25–32 |
