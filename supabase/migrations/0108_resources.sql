-- bookable_resources: physical resources bookable alongside staff calendars
CREATE TABLE bookable_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'room', 'station', 'equipment', 'vehicle', 'other'
  )),
  capacity INTEGER DEFAULT 1,
  color TEXT DEFAULT '#007A6E',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON bookable_resources(tenant_id, status);

-- resource_bookings: tracks which resource is booked at which time
CREATE TABLE resource_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES bookable_resources(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  booked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);
CREATE INDEX ON resource_bookings(tenant_id, start_time);
CREATE INDEX ON resource_bookings(resource_id, start_time);
CREATE INDEX ON resource_bookings(appointment_id);
