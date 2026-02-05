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
    <div className="flex-1 flex items-end justify-center min-h-0 pb-4">
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="w-40 max-h-[30vh] h-auto object-contain transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;