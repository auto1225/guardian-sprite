import meercopCharacter from "@/assets/meercop-character.png";

interface MeercopCharacterProps {
  isMonitoring?: boolean;
}

const MeercopCharacter = ({ isMonitoring = false }: MeercopCharacterProps) => {
  return (
    <div className="flex-1 flex items-end justify-center relative overflow-hidden min-h-0">
      {/* Clouds */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-8 left-4 w-20 h-6 bg-white/30 rounded-full" />
        <div className="absolute top-6 left-8 w-12 h-4 bg-white/30 rounded-full" />
        <div className="absolute top-14 right-8 w-24 h-8 bg-white/25 rounded-full" />
        <div className="absolute top-12 right-16 w-14 h-5 bg-white/25 rounded-full" />
        <div className="absolute bottom-48 right-4 w-18 h-6 bg-white/20 rounded-full" />
        <div className="absolute bottom-44 right-8 w-10 h-4 bg-white/20 rounded-full" />
        <div className="absolute bottom-52 left-6 w-16 h-5 bg-white/25 rounded-full" />
        <div className="absolute bottom-48 left-10 w-8 h-3 bg-white/25 rounded-full" />
      </div>
      
      {/* Ground/Rock */}
      <div className="absolute bottom-0 left-0 right-0 h-28">
        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-[120%] h-full bg-gradient-to-t from-amber-800 via-amber-700 to-amber-600 rounded-t-[60%]" />
      </div>
      
      {/* Character */}
      <img 
        src={meercopCharacter} 
        alt="MeerCOP Character" 
        className={`relative z-10 w-56 max-h-[45vh] h-auto object-contain mb-4 transition-all duration-300 ${
          isMonitoring ? "opacity-100" : "opacity-90"
        }`}
      />
    </div>
  );
};

export default MeercopCharacter;