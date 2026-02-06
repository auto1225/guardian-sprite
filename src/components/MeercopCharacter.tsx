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
      className="scene-wrapper"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        zIndex: 0,
        // Clip the sky portion on tall screens, keep mountain anchored at bottom
        maxHeight: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* 
        Mountain Image - Determines container height.
        Image structure: 80% sky (top) + 20% mountain (bottom)
        Width 100% ensures proportional scaling.
      */}
      <img 
        src={mainBg} 
        alt="Mountain Background" 
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          // Anchor image to bottom so sky gets clipped, not mountain
          position: 'relative',
        }}
      />
      
      {/* 
        Character Group - Math-based positioning:
        Mountain occupies bottom 20% of image.
        Character feet should land at ~19% (just above mountain peak).
      */}
      <div 
        className="character-group"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: '19%', // Calculated: mountain peak is at ~20% of image height
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          zIndex: 1,
        }}
      >
        {/* Speech Bubble - Glued to character hat with negative margin */}
        {statusMessage && (
          <div 
            className="w-[85vw] max-w-sm"
            style={{ marginBottom: '-5px' }}
          >
            <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
              <p className="text-center font-medium text-sm text-card-foreground">
                {statusMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Meerkat Character - Feet on mountain peak */}
        <img 
          src={getCharacterImage()} 
          alt="MeerCOP Character" 
          style={{
            width: '18rem',
            maxWidth: '65vw',
            height: 'auto',
            objectFit: 'contain',
            transition: 'all 0.3s',
          }}
        />
      </div>
    </div>
  );
};

export default MeercopCharacter;
