import { Shield, ShieldCheck, Monitor } from "lucide-react";

interface ToggleButtonProps {
  isOn: boolean;
  onToggle: () => void;
  isCamouflage?: boolean;
  onCamouflageToggle?: () => void;
}

const ToggleButton = ({ isOn, onToggle, isCamouflage, onCamouflageToggle }: ToggleButtonProps) => {
  return (
    <div className="pb-4 pt-2 flex justify-center items-center z-20 px-6 gap-3 w-full">
      {/* MeerCOP Toggle - wide glassmorphism pill */}
      <button 
        onClick={onToggle}
        className="flex-1 flex items-center justify-center gap-3 px-6 py-3.5 rounded-full font-bold text-lg transition-all border"
        style={{
          background: isOn
            ? 'linear-gradient(135deg, hsla(80, 70%, 45%, 0.35) 0%, hsla(55, 80%, 50%, 0.25) 100%)'
            : 'linear-gradient(135deg, hsla(30, 20%, 40%, 0.4) 0%, hsla(20, 15%, 35%, 0.35) 100%)',
          backdropFilter: 'blur(20px)',
          borderColor: isOn ? 'hsla(80, 60%, 50%, 0.5)' : 'hsla(30, 10%, 50%, 0.3)',
          boxShadow: isOn
            ? '0 4px 20px hsla(80, 60%, 40%, 0.3), inset 0 1px 0 hsla(0, 0%, 100%, 0.15)'
            : '0 4px 20px hsla(0, 0%, 0%, 0.2), inset 0 1px 0 hsla(0, 0%, 100%, 0.1)',
        }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            background: isOn
              ? 'hsla(80, 60%, 50%, 0.3)'
              : 'hsla(0, 0%, 60%, 0.25)',
          }}
        >
          {isOn ? (
            <ShieldCheck className="w-5 h-5" style={{ color: 'hsl(80, 70%, 55%)' }} />
          ) : (
            <Shield className="w-5 h-5" style={{ color: 'hsla(0, 0%, 80%, 0.7)' }} />
          )}
        </div>
        <span
          style={{
            color: isOn ? 'hsl(55, 80%, 60%)' : 'hsla(0, 0%, 75%, 0.8)',
          }}
        >
          MeerCOP {isOn ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* Camouflage Toggle - matching pill style */}
      {onCamouflageToggle && (
        <button
          onClick={onCamouflageToggle}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-all border"
          style={{
            background: isCamouflage
              ? 'linear-gradient(135deg, hsla(220, 30%, 20%, 0.6) 0%, hsla(220, 25%, 15%, 0.5) 100%)'
              : 'linear-gradient(135deg, hsla(30, 20%, 40%, 0.4) 0%, hsla(20, 15%, 35%, 0.35) 100%)',
            backdropFilter: 'blur(20px)',
            borderColor: isCamouflage ? 'hsla(220, 40%, 50%, 0.5)' : 'hsla(30, 10%, 50%, 0.3)',
            boxShadow: isCamouflage
              ? '0 4px 15px hsla(220, 40%, 30%, 0.4), inset 0 1px 0 hsla(0, 0%, 100%, 0.1)'
              : '0 4px 15px hsla(0, 0%, 0%, 0.15), inset 0 1px 0 hsla(0, 0%, 100%, 0.1)',
          }}
        >
          <Monitor
            className="w-5 h-5"
            style={{
              color: isCamouflage ? 'hsl(210, 60%, 70%)' : 'hsla(0, 0%, 75%, 0.7)',
            }}
          />
        </button>
      )}
    </div>
  );
};

export default ToggleButton;