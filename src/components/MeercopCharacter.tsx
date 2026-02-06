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
      {/* Character wrapper - positioned at bottom, standing ON the rock */}
      <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2 flex flex-col items-center">
        {/* Speech bubble - follows character's hat */}
        {statusMessage && (
          <div className="w-[85vw] max-w-sm z-10 mb-1">
            <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
              <p className="text-center font-medium text-sm text-card-foreground">
                {statusMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Character image */}
        <img 
          src={getCharacterImage()} 
          alt="MeerCOP Character" 
          className="w-[20rem] max-w-[75vw] h-auto object-contain transition-all duration-300"
        />
      </div>
    </div>
  );
};

export default MeercopCharacter;