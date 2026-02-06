import meercopOff from "@/assets/meercop-off.png";
import meercopOn from "@/assets/meercop-on.png";
import meercopAlert from "@/assets/meercop-alert.png";
import mainBg from "@/assets/main-bg.png";

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
    <div 
      className="scene-container"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        // CRITICAL: Also set position: relative so absolute children use this as reference
        // Height is NOT set - it's determined solely by the mountain image
      }}
    >
      {/* 
        Mountain Image - This determines the container height.
        When screen width shrinks, image height shrinks proportionally,
        and container height follows.
      */}
      <img 
        src={mainBg} 
        alt="Mountain Background" 
        style={{
          width: '100%',
          height: 'auto',
          display: 'block', // Remove bottom gap
        }}
      />
      
      {/* 
        Character Wrapper - Positioned relative to container (mountain image height)
        Using % for bottom ensures character scales with mountain
      */}
      <div 
        className="character-wrapper"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: '58%', // % of container height (mountain image height)
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Speech Bubble - Glued to character hat with negative margin */}
        {statusMessage && (
          <div 
            className="speech-bubble w-[85vw] max-w-sm"
            style={{ marginBottom: '-8px' }}
          >
            <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
              <p className="text-center font-medium text-sm text-card-foreground">
                {statusMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Meerkat Character */}
        <img 
          src={getCharacterImage()} 
          alt="MeerCOP Character" 
          className="w-[18rem] max-w-[65vw] h-auto object-contain transition-all duration-300"
        />
      </div>
    </div>
  );
};

export default MeercopCharacter;
