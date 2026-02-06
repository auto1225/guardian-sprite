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
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        width: '100%',
        zIndex: 0,
        // NO height, NO aspectRatio - height is determined by the img tag inside
      }}
    >
      {/* 
        Mountain Image - THIS determines the container height.
        When screen width changes, image height changes proportionally,
        and the container height follows 1:1.
      */}
      <img 
        src={mainBg} 
        alt="Mountain Background" 
        style={{
          width: '100%',
          height: 'auto',
          display: 'block', // Removes bottom gap
        }}
      />
      
      {/* 
        Character Group - Positioned relative to container (= image height).
        Since container height = image height, bottom % will always land
        at the exact same visual spot on the mountain.
      */}
      <div 
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: '18%', // Adjust this to match mountain peak position
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          zIndex: 1,
        }}
      >
        {/* Speech Bubble - Negative margin glues it to character's hat */}
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
        
        {/* Meerkat Character */}
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
