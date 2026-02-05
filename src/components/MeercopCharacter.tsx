import meercopOff from "@/assets/meercop-off.png";
import meercopOn from "@/assets/meercop-on.png";
import meercopAlert from "@/assets/meercop-alert.png";

interface MeercopCharacterProps {
  isMonitoring?: boolean;
  isAlert?: boolean;
}

const MeercopCharacter = ({ isMonitoring = false, isAlert = false }: MeercopCharacterProps) => {
  const getCharacterImage = () => {
    if (isAlert) return meercopAlert;
    if (isMonitoring) return meercopOn;
    return meercopOff;
  };

  return (
    <div className="flex-1 relative min-h-0">
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="absolute bottom-[15%] left-1/2 -translate-x-1/2 w-64 h-auto object-contain transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;