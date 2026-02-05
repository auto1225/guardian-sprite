import meercopOff from "@/assets/meercop-off.png";
import meercopOn from "@/assets/meercop-on.png";
import meercopAlert from "@/assets/meercop-alert.png";
import mainBg from "@/assets/main-bg.png";

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
    <div className="flex-1 flex items-end justify-center relative overflow-hidden min-h-0">
      {/* Background Image */}
      <img 
        src={mainBg} 
        alt="Background" 
        className="absolute inset-0 w-full h-full object-cover object-bottom"
      />
      
      {/* Character */}
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="relative z-10 w-48 max-h-[40vh] h-auto object-contain mb-8 transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;