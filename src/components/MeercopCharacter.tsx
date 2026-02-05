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
      {/* Speech bubble above character */}
      {statusMessage && (
        <div className="absolute bottom-[45%] left-1/2 -translate-x-1/2 w-[85%] max-w-sm z-10">
          <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
            <p className="text-center font-medium text-sm text-card-foreground">
              {statusMessage}
            </p>
          </div>
        </div>
      )}
      
      {/* Character */}
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="absolute bottom-[4%] left-1/2 -translate-x-1/2 w-64 h-auto object-contain transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;