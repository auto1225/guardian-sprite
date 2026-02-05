-- WebRTC 시그널링 테이블 생성
CREATE TABLE public.webrtc_signaling (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- 인덱스 추가
CREATE INDEX idx_webrtc_signaling_device_session 
ON public.webrtc_signaling(device_id, session_id);

CREATE INDEX idx_webrtc_signaling_expires 
ON public.webrtc_signaling(expires_at);

-- RLS 활성화
ALTER TABLE public.webrtc_signaling ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자가 읽기/쓰기 가능
CREATE POLICY "Allow all authenticated users to read" 
ON public.webrtc_signaling 
FOR SELECT 
USING (true);

CREATE POLICY "Allow all authenticated users to insert" 
ON public.webrtc_signaling 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow all authenticated users to delete" 
ON public.webrtc_signaling 
FOR DELETE 
USING (true);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE public.webrtc_signaling;

-- 만료된 레코드 정리 함수
CREATE OR REPLACE FUNCTION public.cleanup_expired_signaling()
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.webrtc_signaling WHERE expires_at < now();
END;
$$;