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
    <div className="flex-1 flex items-end justify-center relative overflow-hidden min-h-0">
      {/* Clouds */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-8 left-4 w-16 h-5 bg-cloud/30 rounded-full" />
        <div className="absolute top-12 right-8 w-20 h-6 bg-cloud/25 rounded-full" />
        <div className="absolute top-24 left-1/4 w-12 h-4 bg-cloud/20 rounded-full" />
        <div className="absolute bottom-40 right-4 w-14 h-5 bg-cloud/25 rounded-full" />
        <div className="absolute bottom-32 left-8 w-10 h-4 bg-cloud/30 rounded-full" />
      </div>
      
      {/* Ground/Rock */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-ground to-rock/80 rounded-t-[50%]" />
      
      {/* Character */}
      <img 
        src={getCharacterImage()} 
        alt="MeerCOP Character" 
        className="relative z-10 w-48 max-h-[40vh] h-auto object-contain -mb-4 transition-all duration-300"
      />
    </div>
  );
};

export default MeercopCharacter;