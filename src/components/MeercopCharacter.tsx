import meercopOff from "@/assets/meercop-off.png";
import meercopOn from "@/assets/meercop-on.png";
import meercopAlert from "@/assets/meercop-alert.png";

interface MeercopCharacterProps {
  isMonitoring?: boolean;
  isAlert?: boolean;
  statusMessage?: string;
}

const MeercopCharacter = ({ isMonitoring = false, isAlert = false, statusMessage }: MeercopCharacterProps) => {
  const getCharacterImage = () => {
    if (isAlert) return meercopAlert;
    if (isMonitoring) return meercopOn;
    return meercopOff;
  };

  return (
    <div className="flex-1 relative min-h-0 overflow-visible">
      {/* 
        Character Wrapper - Precisely positioned to stand ON the mountain peak
        Mountain occupies roughly bottom 25% of main-bg.png
        Character's feet should touch the mountain top, so bottom = ~22% of viewport height
      */}
      <div 
        className="absolute left-1/2 z-20"
        style={{
          transform: 'translateX(-50%)',
          bottom: 'calc(22vh)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Speech Bubble - negative margin to stick directly to character's hat */}
        {statusMessage && (
          <div 
            className="w-[85vw] max-w-sm z-30"
            style={{ marginBottom: '-8px' }}
          >
            <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
              <p className="text-center font-medium text-sm text-card-foreground">
                {statusMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Character Image - feet touch the mountain peak */}
        <img 
          src={getCharacterImage()} 
          alt="MeerCOP Character" 
          className="w-[18rem] max-w-[70vw] h-auto object-contain transition-all duration-300"
        />
      </div>
    </div>
  );
};

export default MeercopCharacter;