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
    <>
      {/* 
        Scene Container - The mountain image determines the container height.
        Character position is set in % relative to this container,
        so when the mountain shrinks, the character position scales proportionally.
      */}
      <div 
        className="scene-container absolute bottom-0 left-0 w-full"
        style={{ zIndex: 1 }}
      >
        {/* Mountain Background - drives the container height */}
        <img 
          src={mainBg} 
          alt="Mountain Background" 
          className="w-full h-auto block"
          style={{ display: 'block' }}
        />
        
        {/* Character Group - positioned relative to mountain container */}
        <div 
          className="character-group absolute left-1/2"
          style={{
            transform: 'translateX(-50%)',
            bottom: '42%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            height: 'fit-content',
            gap: '2px',
            zIndex: 2,
          }}
        >
          {/* Speech Bubble - tightly attached to character hat */}
          {statusMessage && (
            <div 
              className="speech-bubble w-[85vw] max-w-sm"
              style={{ margin: 0 }}
            >
              <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
                <p className="text-center font-medium text-sm text-card-foreground">
                  {statusMessage}
                </p>
              </div>
            </div>
          )}
          
          {/* Character - feet touch mountain peak */}
          <img 
            src={getCharacterImage()} 
            alt="MeerCOP Character" 
            className="character w-[18rem] max-w-[65vw] h-auto object-contain transition-all duration-300"
          />
        </div>
      </div>
    </>
  );
};

export default MeercopCharacter;