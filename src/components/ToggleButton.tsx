 import { Check, Moon } from "lucide-react";
 
 interface ToggleButtonProps {
   isOn: boolean;
   onToggle: () => void;
 }
 
 const ToggleButton = ({ isOn, onToggle }: ToggleButtonProps) => {
   return (
     <div className="absolute bottom-8 left-0 right-0 flex justify-center items-center gap-4 z-20">
       <button 
         onClick={onToggle}
         className={`flex items-center gap-3 px-6 py-3 rounded-full font-bold text-lg transition-all shadow-lg ${
           isOn 
             ? 'bg-accent text-accent-foreground' 
             : 'bg-gray-400 text-gray-700'
         }`}
       >
         <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
           isOn ? 'bg-status-active' : 'bg-gray-500'
         }`}>
           <Check className="w-4 h-4 text-white" strokeWidth={3} />
         </div>
         <span>MeerCOP {isOn ? 'ON' : 'OFF'}</span>
       </button>
       
       <button className="w-12 h-12 bg-sky-dark/50 rounded-full flex items-center justify-center text-primary-foreground border border-primary-foreground/30">
         <Moon className="w-5 h-5" />
       </button>
     </div>
   );
 };
 
 export default ToggleButton;