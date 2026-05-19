CREATE TABLE snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shortcut TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, shortcut)
);
CREATE INDEX ON snippets(tenant_id);

INSERT INTO snippets (tenant_id, name, shortcut, body)
VALUES
  ('018323e5-4866-486e-bc90-15cfeb910fc4', 'Appointment Confirmation', 'confirm', 'Hi {contact_name}! Just confirming your appointment on {date}. Reply STOP to opt out.'),
  ('018323e5-4866-486e-bc90-15cfeb910fc4', 'Follow-up', 'follow', 'Hi {contact_name}, just following up — any questions I can help with?'),
  ('018323e5-4866-486e-bc90-15cfeb910fc4', 'Thank You', 'thanks', 'Thank you for choosing us, {contact_name}! We look forward to seeing you.');
