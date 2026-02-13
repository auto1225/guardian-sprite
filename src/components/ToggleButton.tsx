import toggleOffIcon from "@/assets/toggle-off-icon.png";
import toggleOnIcon from "@/assets/toggle-on-icon.png";

interface ToggleButtonProps {
  isOn: boolean;
  onToggle: () => void;
}

const ToggleButton = ({ isOn, onToggle }: ToggleButtonProps) => {
  return (
    <div className="pb-4 pt-2 flex justify-center items-center z-20 px-4">
      <button 
        onClick={onToggle}
        className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-full font-bold text-base transition-all shadow-lg ${
          isOn 
            ? 'bg-accent text-accent-foreground' 
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <img 
          src={isOn ? toggleOnIcon : toggleOffIcon} 
          alt={isOn ? "ON" : "OFF"} 
          className="w-6 h-6 object-contain"
        />
        <span>MeerCOP {isOn ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
};

export default ToggleButton;