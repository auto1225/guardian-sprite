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
    <div className="flex-1 relative min-h-0 overflow-visible z-20">
      {/* CharacterWrapper - anchored to bottom center, above the mountain */}
      <div 
        className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center"
        style={{ marginBottom: '8vh' }}
      >
        {/* Speech bubble - directly above character's hat with minimal gap */}
        {statusMessage && (
          <div className="w-[85vw] max-w-sm z-30 mb-0">
            <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
              <p className="text-center font-medium text-sm text-card-foreground">
                {statusMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Character image - feet touch the mountain top */}
        <img 
          src={getCharacterImage()} 
          alt="MeerCOP Character" 
          className="w-[18rem] max-w-[70vw] h-auto object-contain transition-all duration-300 z-20"
        />
      </div>
    </div>
  );
};

export default MeercopCharacter;