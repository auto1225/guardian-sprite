
-- push_subscriptions 테이블에 FCM 지원 컬럼 추가
ALTER TABLE public.push_subscriptions 
  ADD COLUMN IF NOT EXISTS token_type text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS fcm_token text;

-- endpoint 컬럼을 nullable로 변경 (FCM은 endpoint 없음)
ALTER TABLE public.push_subscriptions ALTER COLUMN endpoint DROP NOT NULL;
ALTER TABLE public.push_subscriptions ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE public.push_subscriptions ALTER COLUMN auth DROP NOT NULL;

-- FCM 토큰 유니크 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_fcm_token 
  ON public.push_subscriptions (fcm_token) 
  WHERE fcm_token IS NOT NULL;
