-- Add location columns to devices table
ALTER TABLE public.devices
ADD COLUMN latitude DOUBLE PRECISION,
ADD COLUMN longitude DOUBLE PRECISION,
ADD COLUMN location_updated_at TIMESTAMP WITH TIME ZONE;