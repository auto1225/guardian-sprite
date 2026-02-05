 import { Laptop, Shield, Wifi, Camera, Check, Battery } from "lucide-react";
 
 interface StatusItemProps {
   icon: React.ReactNode;
   label: string;
   isActive: boolean;
   batteryLevel?: number;
 }
 
 const StatusItem = ({ icon, label, isActive, batteryLevel }: StatusItemProps) => {
   return (
     <div className="flex flex-col items-center gap-1">
       <div className="relative">
         {batteryLevel !== undefined && (
           <div className="absolute -top-2 -left-1 flex items-center gap-0.5 text-primary-foreground text-xs">
             <span>{batteryLevel}%</span>
             <Battery className="w-3 h-3" />
           </div>
         )}
         <div className="w-14 h-14 bg-sky-light/50 rounded-lg flex items-center justify-center text-primary-foreground relative">
           {icon}
           {isActive && (
             <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-status-badge rounded-full flex items-center justify-center">
               <Check className="w-3 h-3 text-status-active" strokeWidth={3} />
             </div>
           )}
         </div>
       </div>
       <span className="text-primary-foreground text-sm font-medium">{label}</span>
     </div>
   );
 };
 
 const StatusIcons = () => {
   return (
     <div className="flex justify-center gap-6 mt-6 px-4">
       <StatusItem 
         icon={<Laptop className="w-8 h-8" />} 
         label="Laptop" 
         isActive={true}
         batteryLevel={100}
       />
       <StatusItem 
         icon={<Shield className="w-8 h-8" />} 
         label="MeerCOP" 
         isActive={true}
       />
       <StatusItem 
         icon={<Wifi className="w-8 h-8" />} 
         label="Network" 
         isActive={true}
       />
       <StatusItem 
         icon={<Camera className="w-8 h-8" />} 
         label="Camera" 
         isActive={true}
       />
     </div>
   );
 };
 
 export default StatusIcons;