 import { Settings } from "lucide-react";
 
 interface DeviceSelectorProps {
   deviceName: string;
 }
 
 const DeviceSelector = ({ deviceName }: DeviceSelectorProps) => {
   return (
     <div className="flex justify-center mt-4">
       <button className="flex items-center gap-2 bg-sky-dark/50 hover:bg-sky-dark/70 text-primary-foreground px-6 py-2 rounded-full border-2 border-primary-foreground/30 transition-all">
         <span className="font-semibold">{deviceName}</span>
         <Settings className="w-4 h-4" />
       </button>
     </div>
   );
 };
 
 export default DeviceSelector;