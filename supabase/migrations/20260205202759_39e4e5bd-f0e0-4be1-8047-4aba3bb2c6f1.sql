-- Create storage bucket for camera snapshots
INSERT INTO storage.buckets (id, name, public)
VALUES ('camera-snapshots', 'camera-snapshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their device folders
CREATE POLICY "Users can upload camera snapshots"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'camera-snapshots' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to view their snapshots
CREATE POLICY "Users can view camera snapshots"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'camera-snapshots'
  AND auth.role() = 'authenticated'
);

-- Allow public access to view snapshots (for image URLs)
CREATE POLICY "Public can view camera snapshots"
ON storage.objects FOR SELECT
USING (bucket_id = 'camera-snapshots');