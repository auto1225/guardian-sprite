import { Check, Shield } from "lucide-react";

interface ToggleButtonProps {
  isOn: boolean;
  onToggle: () => void;
}

const ToggleButton = ({ isOn, onToggle }: ToggleButtonProps) => {
  return (
    <div className="pb-6 pt-4 flex justify-center items-center z-20 px-4">
      <button 
        onClick={onToggle}
        className={`flex items-center justify-center gap-3 px-8 py-3 rounded-full font-bold text-lg transition-all shadow-lg ${
          isOn 
            ? 'bg-accent text-accent-foreground' 
            : 'bg-muted text-muted-foreground'
        }`}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
          isOn ? 'bg-status-active' : 'bg-muted-foreground'
        }`}>
          {isOn ? (
            <Check className="w-4 h-4 text-white" strokeWidth={3} />
          ) : (
            <Shield className="w-4 h-4 text-white" />
          )}
        </div>
        <span>MeerCOP {isOn ? 'ON' : 'OFF'}</span>
      </button>
    </div>
  );
};

export default ToggleButton;