-- Widens the contact_source enum. Found while building the inbound-webhook
-- automation trigger: four live routes (booking-public.ts, customer-referrals.ts,
-- gift-cards-public.ts, sms-webhooks.ts) insert new contacts with a source
-- literal ('referral_link', 'booking_page', 'gift_card_purchase', 'sms') that
-- was never a valid contact_source label — every one of those inserts throws
-- 22P02 and has been failing silently in prod. The first three were fixed in
-- application code to use existing valid labels ('referral', 'web_form');
-- 'sms' has no good existing fit, so it's added here alongside
-- 'inbound_webhook' for the new trigger being built now.

ALTER TYPE contact_source ADD VALUE IF NOT EXISTS 'sms';
ALTER TYPE contact_source ADD VALUE IF NOT EXISTS 'inbound_webhook';
