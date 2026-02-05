import { ShieldAlert } from "lucide-react";

interface ToggleButtonProps {
  isOn: boolean;
  onToggle: () => void;
}

const ToggleButton = ({ isOn, onToggle }: ToggleButtonProps) => {
  return (
    <div className="pb-8 pt-4 flex justify-center items-center z-20 px-4">
      <div className="bg-gray-700/90 rounded-full flex items-center p-1.5 w-full max-w-xs">
        <button 
          onClick={onToggle}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-base transition-all flex-1 ${
            !isOn 
              ? 'bg-gray-600 text-white' 
              : 'bg-transparent text-gray-400'
          }`}
        >
          <span>감시 시작하기</span>
          <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-destructive" />
          </div>
        </button>
        
        <button 
          onClick={onToggle}
          className={`flex items-center justify-center px-6 py-3 rounded-full font-bold text-base transition-all flex-1 ${
            isOn 
              ? 'bg-accent text-accent-foreground' 
              : 'bg-transparent text-gray-400'
          }`}
        >
          <span>감시 ON</span>
        </button>
      </div>
    </div>
  );
};

export default ToggleButton;