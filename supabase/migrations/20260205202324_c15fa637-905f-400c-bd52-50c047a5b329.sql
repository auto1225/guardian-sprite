-- Add streaming request flag to devices table
ALTER TABLE public.devices 
ADD COLUMN IF NOT EXISTS is_streaming_requested boolean DEFAULT false;

-- Add comment
COMMENT ON COLUMN public.devices.is_streaming_requested IS 'When true, the laptop should start camera streaming';
