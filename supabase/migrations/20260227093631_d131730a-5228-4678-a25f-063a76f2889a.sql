
-- Add plan_type column to licenses table
ALTER TABLE public.licenses 
ADD COLUMN IF NOT EXISTS plan_type text NOT NULL DEFAULT 'trial';

-- Add comment for clarity
COMMENT ON COLUMN public.licenses.plan_type IS 'Plan type: trial, basic, premium';
