 import meercopCharacter from "@/assets/meercop-character.png";
 
 const MeercopCharacter = () => {
   return (
     <div className="flex-1 flex items-end justify-center relative overflow-hidden">
       {/* Clouds */}
       <div className="absolute inset-0 pointer-events-none">
         <div className="absolute top-8 left-4 w-16 h-6 bg-cloud/30 rounded-full blur-sm" />
         <div className="absolute top-12 right-8 w-20 h-8 bg-cloud/20 rounded-full blur-sm" />
         <div className="absolute top-24 left-1/4 w-12 h-4 bg-cloud/25 rounded-full blur-sm" />
         <div className="absolute bottom-40 right-4 w-14 h-5 bg-cloud/20 rounded-full blur-sm" />
         <div className="absolute bottom-32 left-8 w-10 h-4 bg-cloud/30 rounded-full blur-sm" />
       </div>
       
       {/* Ground/Rock */}
       <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-ground to-rock/80 rounded-t-[50%]" />
       
       {/* Character */}
       <img 
         src={meercopCharacter} 
         alt="MeerCOP Character" 
         className="relative z-10 w-64 h-auto object-contain -mb-4"
       />
     </div>
   );
 };
 
 export default MeercopCharacter;