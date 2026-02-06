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
      className="ratio-container"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        // CRITICAL: aspect-ratio locks the container's proportions
        // When width shrinks, height shrinks proportionally
        aspectRatio: '375 / 667', // Approximate ratio of main-bg.png (mobile portrait)
        backgroundImage: `url(${mainBg})`,
        backgroundSize: 'cover',
        backgroundPosition: 'bottom center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* 
        Character Group - Positioned using % relative to the ratio-locked container.
        Because the container maintains its aspect ratio, the % position
        will always land at the same visual spot on the mountain.
      */}
      <div 
        className="character-group"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: '28%', // % of container height - adjust to match mountain peak
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Speech Bubble - Negative margin glues it to character's hat */}
        {statusMessage && (
          <div 
            className="speech-bubble w-[85vw] max-w-sm"
            style={{ marginBottom: '-5px' }}
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
