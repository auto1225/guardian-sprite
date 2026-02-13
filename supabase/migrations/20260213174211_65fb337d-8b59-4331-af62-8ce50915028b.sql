
-- 1. licenses 테이블에 device_id 컬럼 추가 (기기별 시리얼)
ALTER TABLE public.licenses ADD COLUMN device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL;

-- 2. 기존 회원가입 트리거 제거 (더 이상 사용자 단위 자동 발급 안 함)
DROP TRIGGER IF EXISTS on_auth_user_created_license ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_license();

-- 3. 기존 데이터 마이그레이션: 기존 시리얼에 기기 연결
UPDATE public.licenses l
SET device_id = (
  SELECT d.id FROM public.devices d 
  WHERE d.user_id = l.user_id 
  ORDER BY d.created_at ASC 
  LIMIT 1
)
WHERE l.device_id IS NULL;
