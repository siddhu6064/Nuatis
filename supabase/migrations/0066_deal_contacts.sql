CREATE TABLE IF NOT EXISTS deal_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(deal_id, contact_id)
);

CREATE INDEX IF NOT EXISTS deal_contacts_deal_id_idx ON deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS deal_contacts_contact_id_idx ON deal_contacts(contact_id);
