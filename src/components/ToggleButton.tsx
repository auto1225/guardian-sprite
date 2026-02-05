import { Check, Shield } from "lucide-react";

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
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
          isOn ? 'bg-status-active' : 'bg-muted-foreground'
        }`}>
          {isOn ? (
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          ) : (
            <Shield className="w-3.5 h-3.5 text-white" />
          )}
        </div>
        <span>MeerCOP {isOn ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
};

export default ToggleButton;