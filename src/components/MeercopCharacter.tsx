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
        // NO height - determined only by the mountain image
      }}
    >
      {/* Mountain Image - drives the wrapper height */}
      <img 
        src={mainBg} 
        alt="Mountain Background" 
        style={{
          width: '100%',
          display: 'block',
          height: 'auto',
        }}
      />
      
      {/* Character Group - positioned relative to mountain image height */}
      <div 
        className="character-group"
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: '55%', // Adjust this to align with mountain peak
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {/* Speech Bubble - attached to character hat */}
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
        
        {/* Meerkat Character - feet on mountain peak */}
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
