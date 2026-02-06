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
    <div className="flex-1 relative min-h-0">
      {/* Speech bubble - positioned above character's hat */}
      {statusMessage && (
        <div className="absolute bottom-[58%] left-1/2 -translate-x-1/2 w-[85%] max-w-sm z-10">
          <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
            <p className="text-center font-medium text-sm text-card-foreground">
              {statusMessage}
            </p>
          </div>
        </div>
      )}
      
      {/* Character - positioned at bottom touching rock mountain */}
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="absolute bottom-[-18%] left-1/2 -translate-x-1/2 w-[22rem] max-w-[85vw] h-auto object-contain transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;