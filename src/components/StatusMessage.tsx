 interface StatusMessageProps {
   deviceName: string;
   isMonitoring: boolean;
 }
 
 const StatusMessage = ({ deviceName, isMonitoring }: StatusMessageProps) => {
   return (
     <div className="mx-6 mt-6">
       <div className="bg-card/95 rounded-2xl px-6 py-4 shadow-lg">
         <p className="text-card-foreground text-center font-medium">
           {isMonitoring 
             ? `MeerCOP is monitoring your laptop (${deviceName}).`
             : `MeerCOP is not monitoring your laptop.`
           }
         </p>
       </div>
     </div>
   );
 };
 
 export default StatusMessage;