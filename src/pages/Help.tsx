import { ArrowLeft, Shield, ShieldCheck, Monitor, Camera, MapPin, Bell, Settings, Smartphone, Laptop, AlertTriangle, HelpCircle, ChevronDown, Users, Download, Volume2, Eye, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import meercopCharacter from "@/assets/meercop-character.png";

interface HelpPageProps {
  isOpen?: boolean;
  onClose?: () => void;
}

const SectionTitle = ({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'hsla(52, 100%, 60%, 0.2)' }}>
      <Icon className="w-4 h-4" style={{ color: 'hsl(52, 100%, 60%)' }} />
    </div>
    <h2 className="text-white font-bold text-base">{children}</h2>
  </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl p-4 mb-3">
    {children}
  </div>
);

const HelpPage = ({ isOpen = true, onClose }: HelpPageProps) => {
  const navigate = useNavigate();

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(-1);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
      style={{
        background: 'linear-gradient(180deg, hsla(200, 70%, 50%, 1) 0%, hsla(200, 65%, 38%, 1) 100%)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-white/20 shrink-0">
        <button onClick={handleClose} className="text-white hover:text-white/80 transition-colors">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-white font-bold text-lg">사용 설명서</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 alert-history-scroll">
        {/* App Introduction */}
        <div className="flex flex-col items-center text-center mb-2">
          <img src={meercopCharacter} alt="MeerCOP" className="w-20 h-20 object-contain mb-2" />
          <h1 className="text-white font-black text-xl">MeerCOP</h1>
          <p className="text-white/70 text-sm mt-1">노트북 도난 방지 & 원격 감시 앱</p>
          <p className="text-white/50 text-xs mt-1">ver 1.0.6</p>
        </div>

        {/* ──────────── 1. 개요 ──────────── */}
        <SectionTitle icon={Shield}>앱 소개</SectionTitle>
        <Card>
          <p className="text-white/90 text-sm leading-relaxed">
            <strong className="text-white">MeerCOP</strong>은 노트북(컴퓨터)의 도난 · 무단 사용을 방지하기 위한 실시간 감시 앱입니다.
            스마트폰에서 감시를 켜면, 노트북에 움직임 · 터치 · 덮개 열림 등이 감지될 때 즉시 경보가 울리고
            사진 · 위치 · 실시간 스트리밍을 통해 상황을 파악할 수 있습니다.
          </p>
        </Card>

        {/* ──────────── 2. 시작하기 ──────────── */}
        <SectionTitle icon={Download}>시작하기</SectionTitle>
        <Card>
          <h3 className="text-white font-semibold text-sm mb-2">① 계정 생성</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">
            이메일과 비밀번호로 회원가입 후 이메일 인증을 완료합니다. 인증 후 로그인할 수 있습니다.
          </p>

          <h3 className="text-white font-semibold text-sm mb-2">② 노트북에 앱 설치</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">
            노트북 브라우저에서 MeerCOP 사이트에 접속 → 시리얼 넘버를 입력하여 기기를 등록합니다.
            등록된 노트북은 자동으로 온라인 상태가 되어 스마트폰과 연동됩니다.
          </p>

          <h3 className="text-white font-semibold text-sm mb-2">③ 스마트폰 앱 설치 (PWA)</h3>
          <p className="text-white/80 text-sm leading-relaxed">
            스마트폰 브라우저에서 접속 후 <strong className="text-white">"홈 화면에 추가"</strong>로 설치합니다.
            Android는 설치 팝업이 자동으로 나타나고, iOS는 Safari의 공유 버튼 → "홈 화면에 추가"를 선택합니다.
          </p>
        </Card>

        {/* ──────────── 3. 메인 화면 ──────────── */}
        <SectionTitle icon={Smartphone}>메인 화면 구성</SectionTitle>
        <Card>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Laptop className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">기기 선택 바</p>
                <p className="text-white/70 text-xs">상단에서 감시 대상 노트북을 선택합니다. 여러 대 등록 시 탭하여 전환합니다.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Eye className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">상태 아이콘</p>
                <p className="text-white/70 text-xs">노트북 위치(📍), 카메라(📷), 네트워크(🌐), 설정(⚙️) 아이콘을 탭하면 각 기능에 접근합니다.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">감시 토글 버튼</p>
                <p className="text-white/70 text-xs">화면 하단의 "MeerCOP ON/OFF" 버튼으로 감시를 시작하거나 중지합니다.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
                <Monitor className="w-3.5 h-3.5 text-white/80" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">위장 모드</p>
                <p className="text-white/70 text-xs">감시 버튼 옆 모니터 아이콘을 탭하면 노트북 화면을 꺼진 것처럼 위장합니다. 감시는 계속 작동합니다.</p>
              </div>
            </div>
          </div>
        </Card>

        {/* ──────────── 4. 감시 기능 ──────────── */}
        <SectionTitle icon={ShieldCheck}>감시 기능</SectionTitle>
        <Card>
          <h3 className="text-white font-semibold text-sm mb-2">감시 모드 ON</h3>
          <p className="text-white/80 text-sm leading-relaxed mb-3">
            감시를 켜면 노트북의 가속도 센서, 카메라, 키보드/마우스 입력 등을 모니터링합니다.
            이상이 감지되면 즉시 스마트폰에 경보가 전달됩니다.
          </p>

          <h3 className="text-white font-semibold text-sm mb-2">감지 항목</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">움직임 감지</strong> — 노트북이 흔들리거나 이동할 때</li>
            <li>• <strong className="text-white">덮개 열림</strong> — 닫힌 노트북 덮개가 열릴 때</li>
            <li>• <strong className="text-white">키보드/마우스</strong> — 무단 입력이 감지될 때</li>
            <li>• <strong className="text-white">카메라 움직임</strong> — 카메라 앞 움직임 감지 시</li>
            <li>• <strong className="text-white">USB 장치</strong> — 허가되지 않은 USB 연결 시</li>
            <li>• <strong className="text-white">전원 변경</strong> — 충전기 분리/연결 시</li>
          </ul>
        </Card>

        {/* ──────────── 5. 경보 화면 ──────────── */}
        <SectionTitle icon={AlertTriangle}>경보 발생 시</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-3">
            이상이 감지되면 스마트폰과 노트북 모두에서 경보음이 울리고, 전체 화면 경보 모드로 전환됩니다.
          </p>
          <h3 className="text-white font-semibold text-sm mb-2">경보 화면 구성</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">🎥 실시간 스트리밍</strong> — 노트북 카메라의 실시간 영상 (카메라 연결 시)</li>
            <li>• <strong className="text-white">📍 노트북 위치</strong> — 지도에서 현재 위치 확인 (위치 정보 있을 시)</li>
            <li>• <strong className="text-white">📷 캡처 사진</strong> — 감지 순간 자동 촬영된 사진</li>
          </ul>
          <p className="text-white/70 text-sm mt-3 leading-relaxed">
            각 항목이 사용 불가한 경우 "인식되지 않습니다" 또는 "정보 없음"으로 표시되며, 경보 화면 틀은 유지됩니다.
          </p>

          <h3 className="text-white font-semibold text-sm mt-3 mb-2">경보 해제</h3>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">🔕 스마트폰 경보음 해제</strong> — 스마트폰의 경보음만 중지</li>
            <li>• <strong className="text-white">🔇 컴퓨터 경보음 해제</strong> — 노트북의 경보음도 원격 해제 (전체 경보 종료)</li>
          </ul>
        </Card>

        {/* ──────────── 6. 카메라 ──────────── */}
        <SectionTitle icon={Camera}>카메라 기능</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">
            메인 화면의 카메라(📷) 아이콘을 탭하면 카메라 화면에 진입합니다.
          </p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• <strong className="text-white">실시간 스트리밍</strong> — 노트북 카메라의 실시간 영상을 확인합니다</li>
            <li>• <strong className="text-white">스냅샷 촬영</strong> — 현재 화면을 캡처하여 저장합니다</li>
            <li>• <strong className="text-white">카메라 전환</strong> — 전면/후면 카메라 전환 (지원 시)</li>
          </ul>
        </Card>

        {/* ──────────── 7. 위치 추적 ──────────── */}
        <SectionTitle icon={MapPin}>위치 추적</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">
            메인 화면의 노트북(📍) 아이콘을 탭하면 노트북의 현재 위치를 지도에서 확인할 수 있습니다.
          </p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• GPS 또는 IP 기반 위치 확인</li>
            <li>• 경보 발생 시 감지 위치 자동 기록</li>
            <li>• 주소 정보 표시 (역 지오코딩)</li>
          </ul>
        </Card>

        {/* ──────────── 8. 네트워크 정보 ──────────── */}
        <SectionTitle icon={Wifi}>네트워크 정보</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">
            메인 화면의 네트워크(🌐) 아이콘을 탭하면 노트북의 네트워크 연결 상태, IP 주소 등 정보를 확인할 수 있습니다.
            네트워크가 끊어지면 메인 화면에 경고 메시지가 표시됩니다.
          </p>
        </Card>

        {/* ──────────── 9. 설정 ──────────── */}
        <SectionTitle icon={Settings}>설정</SectionTitle>
        <Card>
          <div className="space-y-3">
            <div>
              <p className="text-white font-semibold text-sm">기기 닉네임</p>
              <p className="text-white/70 text-xs">노트북의 표시 이름을 변경합니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">경보 비밀번호 (PIN)</p>
              <p className="text-white/70 text-xs">노트북에서 경보를 해제할 때 필요한 4자리 비밀번호입니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">경보음 선택</p>
              <p className="text-white/70 text-xs">호루라기, 사이렌, 새소리 등 다양한 경보음을 선택하거나 사용자 지정 파일을 업로드할 수 있습니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">경보음 볼륨</p>
              <p className="text-white/70 text-xs">스마트폰 경보음의 볼륨을 조절합니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">감지 센서 설정</p>
              <p className="text-white/70 text-xs">덮개, 카메라, 키보드, 마우스, USB, 전원 등 각 센서의 활성화/비활성화를 설정합니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">감도 설정</p>
              <p className="text-white/70 text-xs">움직임 감지와 마우스 감지의 민감도(민감/보통/둔감)를 조절합니다.</p>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">시리얼 넘버</p>
              <p className="text-white/70 text-xs">등록된 시리얼 넘버를 확인하고 탭하여 복사할 수 있습니다.</p>
            </div>
          </div>
        </Card>

        {/* ──────────── 10. 기기 관리 ──────────── */}
        <SectionTitle icon={Users}>기기 관리</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed mb-2">
            헤더의 기기 관리 버튼을 탭하면 등록된 모든 기기를 관리할 수 있습니다.
          </p>
          <ul className="text-white/80 text-sm space-y-1.5 ml-1">
            <li>• 기기 추가 / 삭제</li>
            <li>• 기기별 경보 이력 조회</li>
            <li>• 기기 상태 확인 (온라인/오프라인)</li>
          </ul>
        </Card>

        {/* ──────────── 11. 사진 경보 이력 ──────────── */}
        <SectionTitle icon={Camera}>사진 경보 이력</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">
            사이드 메뉴에서 "사진 경보 이력"을 탭하면 과거 경보 시 촬영된 사진들을 확인할 수 있습니다.
            사진을 탭하면 전체 화면으로 보고, 저장할 수 있습니다. 불필요한 이력은 삭제할 수 있습니다.
          </p>
        </Card>

        {/* ──────────── 12. 위장 모드 ──────────── */}
        <SectionTitle icon={Monitor}>위장 모드</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">
            위장 모드를 켜면 노트북 화면이 꺼진 것처럼 보이지만 실제로는 감시가 계속 작동합니다.
            도둑이 노트북에 접근해도 화면이 꺼져 있는 것처럼 보여 경계심을 낮출 수 있습니다.
            위장 모드 중에도 카메라 촬영, 위치 추적 등 모든 감시 기능이 정상 작동합니다.
          </p>
        </Card>

        {/* ──────────── 13. 푸시 알림 ──────────── */}
        <SectionTitle icon={Bell}>푸시 알림</SectionTitle>
        <Card>
          <p className="text-white/80 text-sm leading-relaxed">
            기기를 선택하면 자동으로 푸시 알림이 구독됩니다. 앱이 백그라운드에 있어도 경보 발생 시 알림을 받을 수 있습니다.
            브라우저의 알림 권한을 허용해 주세요.
          </p>
        </Card>

        {/* ──────────── FAQ ──────────── */}
        <div className="mt-4">
          <SectionTitle icon={HelpCircle}>자주 묻는 질문 (FAQ)</SectionTitle>
        </div>

        <div className="bg-white/12 backdrop-blur-md border border-white/20 rounded-xl overflow-hidden">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="faq-1" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                감시 모드를 켜면 노트북 배터리가 많이 소모되나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                센서 감지 방식을 사용하므로 일반 사용 대비 약간의 추가 배터리 소모가 있지만, 
                화면이 꺼진 상태에서는 매우 적은 전력만 사용합니다. 카메라 감시를 비활성화하면 
                배터리 소모를 더 줄일 수 있습니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-2" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                인터넷이 끊어지면 감시가 작동하나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                노트북의 로컬 경보(경보음)는 인터넷 없이도 작동합니다. 하지만 스마트폰으로의 알림 전송, 
                사진 전송, 실시간 스트리밍 등 원격 기능은 네트워크 연결이 필요합니다.
                네트워크가 끊어지면 메인 화면에 경고 메시지가 표시됩니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-3" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                여러 대의 노트북을 감시할 수 있나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                네, 시리얼 넘버를 추가 등록하면 여러 대의 노트북을 하나의 계정으로 관리할 수 있습니다.
                메인 화면 상단의 기기 선택 바에서 감시 대상을 전환할 수 있으며, 
                각 기기별로 독립적으로 감시를 켜고 끌 수 있습니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-4" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                경보 비밀번호(PIN)를 잊어버렸어요.
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                스마트폰 앱의 설정에서 경보 비밀번호를 변경할 수 있습니다. 
                설정 → 경보 비밀번호에서 새 4자리 번호를 입력하세요.
                또는 스마트폰에서 "컴퓨터 경보음 해제" 버튼을 사용하여 원격으로 경보를 해제할 수 있습니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-5" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                노트북이 절전 모드에 들어가면 어떻게 되나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                절전 모드에서는 센서와 네트워크가 비활성화되므로 감시 기능이 작동하지 않습니다.
                이 경우 스마트폰 메인 화면에 "⚠️ 컴퓨터와 연결할 수 없습니다" 메시지가 표시됩니다.
                노트북의 절전 설정에서 덮개를 닫아도 절전하지 않도록 설정하는 것을 권장합니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-6" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                경보음을 변경하려면 어떻게 하나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                설정 페이지에서 "경보음 선택"을 탭하면 6종의 내장 경보음 중 선택하거나, 
                사용자 지정 음원 파일(5MB 이하)을 업로드할 수 있습니다. 
                미리듣기 버튼(▶)으로 소리를 확인한 후 선택하세요.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-7" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                카메라가 인식되지 않는다고 나와요.
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                노트북에 웹캠이 없거나, 브라우저에서 카메라 권한이 차단된 경우 발생합니다.
                노트북 브라우저의 주소창 좌측 자물쇠 아이콘 → 사이트 설정에서 카메라 권한을 "허용"으로 변경하세요.
                외장 웹캠을 사용하는 경우 USB 연결 상태를 확인하세요.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-8" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                위치가 정확하지 않아요.
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                노트북은 GPS가 없는 경우가 많아 IP 기반 위치 추적을 사용합니다. 
                IP 기반 위치는 실제 위치와 수 km 차이가 날 수 있습니다.
                Wi-Fi 기반 위치가 가능한 환경에서는 더 정확한 위치를 제공합니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-9" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                시리얼 넘버는 어디서 구하나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                시리얼 넘버는 구매 시 제공되거나 관리자로부터 발급받을 수 있습니다.
                설정 페이지에서 등록된 시리얼 넘버를 확인할 수 있으며, 탭하여 클립보드에 복사할 수 있습니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-10" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                감시 중에 경보 감도를 조절할 수 있나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                네, 설정에서 움직임 감도(민감/보통/둔감)와 마우스 감도를 각각 조절할 수 있습니다.
                "민감"은 작은 진동에도 반응하고, "둔감"은 큰 움직임만 감지합니다.
                카페 등 진동이 있는 환경에서는 "둔감"을 권장합니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-11" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                위장 모드는 어떻게 작동하나요?
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                위장 모드를 켜면 노트북 화면이 완전히 검은색으로 덮여 꺼진 것처럼 보입니다.
                하지만 실제로는 브라우저가 백그라운드에서 모든 감시 기능을 계속 수행합니다.
                카페에서 자리를 비울 때 노트북이 사용 중이 아닌 것처럼 보이게 하여 도난 시도를 유도하고 감지하는 데 활용할 수 있습니다.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-12" className="border-white/10">
              <AccordionTrigger className="px-4 text-white text-sm hover:no-underline">
                앱이 푸시 알림을 보내지 않아요.
              </AccordionTrigger>
              <AccordionContent className="px-4 text-white/70 text-sm">
                1. 브라우저의 알림 권한이 "허용"인지 확인하세요.{"\n"}
                2. iOS Safari에서는 PWA로 설치해야 푸시 알림이 지원됩니다.{"\n"}
                3. 기기를 선택한 상태에서 앱을 다시 열면 자동으로 푸시 구독이 시도됩니다.{"\n"}
                4. 절전 모드, 저전력 모드에서는 알림이 지연될 수 있습니다.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <p className="text-white/40 text-xs">© 2025 MeerCOP. All rights reserved.</p>
          <p className="text-white/30 text-xs mt-1">문의: support@meercop.com</p>
        </div>
      </div>
    </div>
  );
};

export default HelpPage;
