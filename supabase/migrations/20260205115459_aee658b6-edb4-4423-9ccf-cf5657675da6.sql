-- 1. Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Create device_type enum
CREATE TYPE public.device_type AS ENUM ('laptop', 'desktop', 'smartphone');

-- 3. Create device_status enum
CREATE TYPE public.device_status AS ENUM ('online', 'offline', 'monitoring', 'alert');

-- 4. Create devices table
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_type public.device_type NOT NULL,
  status public.device_status NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMP WITH TIME ZONE,
  is_monitoring BOOLEAN NOT NULL DEFAULT false,
  battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 5. Create peripheral_type enum
CREATE TYPE public.peripheral_type AS ENUM ('usb', 'keyboard', 'mouse', 'microphone', 'camera', 'network', 'bluetooth', 'other');

-- 6. Create peripheral_status enum
CREATE TYPE public.peripheral_status AS ENUM ('connected', 'disconnected', 'unauthorized');

-- 7. Create device_peripherals table for monitoring USB, keyboard, mouse, mic, etc.
CREATE TABLE public.device_peripherals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  peripheral_type public.peripheral_type NOT NULL,
  name TEXT NOT NULL,
  status public.peripheral_status NOT NULL DEFAULT 'connected',
  vendor_id TEXT,
  product_id TEXT,
  is_authorized BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMP WITH TIME ZONE
);

-- 8. Create device_locations table for location tracking
CREATE TABLE public.device_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  ip_address TEXT,
  city TEXT,
  country TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 9. Create command_type enum
CREATE TYPE public.command_type AS ENUM ('alarm', 'camera_capture', 'lock', 'locate', 'message');

-- 10. Create command_status enum
CREATE TYPE public.command_status AS ENUM ('pending', 'sent', 'executed', 'failed');

-- 11. Create commands table for remote control
CREATE TABLE public.commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  command_type public.command_type NOT NULL,
  status public.command_status NOT NULL DEFAULT 'pending',
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  executed_at TIMESTAMP WITH TIME ZONE
);

-- 12. Create camera_captures table for intruder photos
CREATE TABLE public.camera_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  command_id UUID REFERENCES public.commands(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 13. Create alert_type enum
CREATE TYPE public.alert_type AS ENUM ('intrusion', 'unauthorized_peripheral', 'location_change', 'offline', 'low_battery');

-- 14. Create alerts table
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  alert_type public.alert_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_peripherals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for devices
CREATE POLICY "Users can view their own devices" ON public.devices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own devices" ON public.devices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own devices" ON public.devices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own devices" ON public.devices FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for device_peripherals (via device ownership)
CREATE POLICY "Users can view peripherals of their devices" ON public.device_peripherals FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = device_peripherals.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can insert peripherals to their devices" ON public.device_peripherals FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = device_peripherals.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can update peripherals of their devices" ON public.device_peripherals FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = device_peripherals.device_id AND devices.user_id = auth.uid()));

-- RLS Policies for device_locations
CREATE POLICY "Users can view locations of their devices" ON public.device_locations FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = device_locations.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can insert locations to their devices" ON public.device_locations FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = device_locations.device_id AND devices.user_id = auth.uid()));

-- RLS Policies for commands
CREATE POLICY "Users can view commands for their devices" ON public.commands FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = commands.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can send commands to their devices" ON public.commands FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = commands.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can update commands for their devices" ON public.commands FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = commands.device_id AND devices.user_id = auth.uid()));

-- RLS Policies for camera_captures
CREATE POLICY "Users can view captures from their devices" ON public.camera_captures FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = camera_captures.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can insert captures to their devices" ON public.camera_captures FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = camera_captures.device_id AND devices.user_id = auth.uid()));

-- RLS Policies for alerts
CREATE POLICY "Users can view alerts for their devices" ON public.alerts FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = alerts.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can insert alerts for their devices" ON public.alerts FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = alerts.device_id AND devices.user_id = auth.uid()));
CREATE POLICY "Users can update alerts for their devices" ON public.alerts FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM public.devices WHERE devices.id = alerts.device_id AND devices.user_id = auth.uid()));

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
ALTER PUBLICATION supabase_realtime ADD TABLE public.device_peripherals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;