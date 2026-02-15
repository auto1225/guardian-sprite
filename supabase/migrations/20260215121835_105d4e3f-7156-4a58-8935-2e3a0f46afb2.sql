
-- Make camera-snapshots bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'camera-snapshots';

-- Drop the public SELECT policy
DROP POLICY IF EXISTS "Public can view camera snapshots" ON storage.objects;

-- Ensure authenticated device owners can still access their snapshots
CREATE POLICY "Device owners can view camera snapshots"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'camera-snapshots' 
  AND auth.role() = 'authenticated'
);
