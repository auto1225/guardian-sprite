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
        className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-full font-extrabold text-base transition-all"
        style={{
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: isOn ? '1px solid hsla(52, 100%, 60%, 0.4)' : '1px solid hsla(0, 0%, 100%, 0.15)',
          background: isOn ? 'hsla(52, 100%, 60%, 0.2)' : 'hsla(0, 0%, 100%, 0.1)',
          color: isOn ? 'hsl(52, 100%, 60%)' : 'hsla(0, 0%, 100%, 0.5)',
          boxShadow: isOn
            ? '0 0 24px hsla(52, 100%, 60%, 0.25), 0 4px 16px hsla(0, 0%, 0%, 0.1)'
            : '0 4px 16px hsla(0, 0%, 0%, 0.06)',
          textShadow: '0 1px 3px hsla(0, 0%, 0%, 0.25)',
        }}
      >
        <img 
          src={isOn ? toggleOnIcon : toggleOffIcon} 
          alt={isOn ? "ON" : "OFF"} 
          className="w-6 h-6 object-contain"
          style={!isOn ? { opacity: 0.5 } : undefined}
        />
        <span>MeerCOP {isOn ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
};

export default ToggleButton;
