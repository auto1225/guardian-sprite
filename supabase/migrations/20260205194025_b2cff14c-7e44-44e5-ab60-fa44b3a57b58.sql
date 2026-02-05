-- Add network and camera connection status columns to devices table
ALTER TABLE public.devices
ADD COLUMN is_network_connected boolean NOT NULL DEFAULT true,
ADD COLUMN is_camera_connected boolean NOT NULL DEFAULT true;