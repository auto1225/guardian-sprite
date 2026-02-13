
-- 시리얼 넘버 생성 함수
CREATE OR REPLACE FUNCTION public.generate_serial_key()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
BEGIN
  FOR i IN 1..12 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    IF i IN (4, 8) THEN
      result := result || '-';
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- 라이선스 테이블
CREATE TABLE public.licenses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  serial_key text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS 활성화
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 자기 라이선스만 조회
CREATE POLICY "Users can view their own licenses"
ON public.licenses FOR SELECT
USING (auth.uid() = user_id);

-- RLS 정책: 자기 라이선스만 업데이트
CREATE POLICY "Users can update their own licenses"
ON public.licenses FOR UPDATE
USING (auth.uid() = user_id);

-- 시리얼 검증용 정책 (service role에서 사용)
-- authenticated 사용자가 serial_key로 조회 가능하도록 (노트북 연결용)
CREATE POLICY "Authenticated users can verify serial keys"
ON public.licenses FOR SELECT
USING (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- 회원가입 시 자동 시리얼 생성 트리거
CREATE OR REPLACE FUNCTION public.handle_new_user_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_serial text;
  max_attempts integer := 10;
  attempt integer := 0;
BEGIN
  LOOP
    attempt := attempt + 1;
    new_serial := generate_serial_key();
    BEGIN
      INSERT INTO public.licenses (user_id, serial_key, is_active)
      VALUES (NEW.id, new_serial, true);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Failed to generate unique serial key after % attempts', max_attempts;
      END IF;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_license
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_license();

-- updated_at 트리거
CREATE TRIGGER update_licenses_updated_at
BEFORE UPDATE ON public.licenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime 활성화 (선택)
ALTER PUBLICATION supabase_realtime ADD TABLE public.licenses;
