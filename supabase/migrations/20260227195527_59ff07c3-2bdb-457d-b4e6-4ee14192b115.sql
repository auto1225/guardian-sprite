-- 중복 랩탑 기기 삭제 (가장 오래된 5b9dc6d9만 유지)
DELETE FROM devices 
WHERE user_id = '6d2a7599-284f-4055-9869-4df7fcf019ed' 
  AND device_type = 'laptop' 
  AND id != '5b9dc6d9-7367-4b60-bdd0-6589b3a4db5c';

-- 남은 랩탑 기기 이름 수정
UPDATE devices 
SET name = 'My Laptop' 
WHERE id = '5b9dc6d9-7367-4b60-bdd0-6589b3a4db5c';