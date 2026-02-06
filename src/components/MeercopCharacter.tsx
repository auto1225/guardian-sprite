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
    <div className="flex flex-col items-center justify-end flex-1 min-h-0">
      {/* Speech bubble - fixed position touching character's hat */}
      {statusMessage && (
        <div className="w-[85%] max-w-sm z-10 -mb-20 shrink-0">
          <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
            <p className="text-center font-medium text-sm text-card-foreground">
              {statusMessage}
            </p>
          </div>
        </div>
      )}
      
      {/* Character - fixed position touching rock mountain */}
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="w-[22rem] max-w-[85vw] h-auto object-contain transition-all duration-300 -mb-[15%] shrink-0"
      />
    </div>
  );
};

export default MeercopCharacter;