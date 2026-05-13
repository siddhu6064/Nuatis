-- Migration 0060: Add P12 vertical slugs to vertical_type enum
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'spa';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'gym';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'nail_bar';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'pet_grooming';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'tattoo';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'car_wash';
ALTER TYPE vertical_type ADD VALUE IF NOT EXISTS 'laundry';
