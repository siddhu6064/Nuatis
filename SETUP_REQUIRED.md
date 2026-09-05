# Setup Required — External Accounts, Keys & Manual Steps

Living checklist. Everything here is code-complete and tested; these are the only things blocking real end-to-end use in production. Update this file whenever a new feature needs an external key/account, and check items off (or delete the line) once done.

Last reviewed: 2026-08-30.

## Env vars not yet set

| Var                                  | Feature                          | Notes                                                                                                             |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `WORKOS_API_KEY`, `WORKOS_CLIENT_ID` | SSO (SAML/OIDC login)            | Needs a real WorkOS account + at least one test SAML/OIDC connection to verify the login round-trip end to end.   |
| `YELP_API_KEY`                       | Reviews — Yelp import            | Yelp Fusion API key.                                                                                              |
| `META_APP_ID`, `META_APP_SECRET`     | Reviews — Facebook               | Also needs Meta App Review before `pages_show_list`/`pages_read_engagement` work for non-test users.              |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Card-on-file / cancellation fees | Setup-intent API already works server-side without it; the Stripe Elements card-entry UI can't render without it. |
| `STRIPE_CONNECT_WEBHOOK_SECRET`      | Stripe Connect                   | See Stripe Dashboard steps below — this comes from creating the second webhook endpoint.                          |

## Manual dashboard steps (no code change possible)

- **Stripe → enable ACH Direct Debit**: Settings → Payment methods (test + live). Code already lets Stripe auto-negotiate payment methods everywhere; the webhook side is already ACH-safe. Just flip the toggle.
- **Stripe → enable Connect on the platform account**, then add a **second webhook endpoint** scoped to "events on connected accounts" pointing at `/api/webhooks/stripe-connect`. Its signing secret becomes `STRIPE_CONNECT_WEBHOOK_SECRET` above. Until Connect is enabled on the account, every "Connect Stripe" attempt fails cleanly with Stripe's own error (verified live).
- **Google Reserve integration** — blocked at the partnership level, not a key. Needs partner credentials directly from Google; nothing to configure until that relationship exists.

## Already configured — nothing needed

Stripe secret key + platform webhook secret, Square (`SQUARE_APP_ID`/`SQUARE_APP_SECRET`, per-tenant OAuth), Resend, Telnyx, Supabase, Redis.

## Known follow-up (dev work, not external setup)

- Stripe Connect's 2% platform fee currently only applies to card-on-file charges (PaymentIntent). Payment Links (gift cards, invoices, staff payment links) don't support `application_fee_amount` in Stripe's API — those route 100% to the connected account today. Closing this needs migrating those flows from Payment Links to Checkout Sessions. See the comment in `apps/api/src/lib/payment-link.ts`'s `createPaymentLink`.
- Stripe Connect wiring deliberately does not cover `lib/stripe-subscriptions.ts`/`routes/subscriptions.ts` (a tenant's own recurring billing of its contacts) — a separate account-pinning problem of similar size, not yet started.
