ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS device_name text;

-- 기존 데이터 마이그레이션: devices.name → licenses.device_name
UPDATE public.licenses l
SET device_name = d.name
FROM public.devices d
WHERE l.device_id = d.id
  AND l.device_name IS NULL;