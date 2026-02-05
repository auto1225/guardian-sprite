import { useState } from "react";
import Header from "@/components/Header";
import DeviceSelector from "@/components/DeviceSelector";
import StatusIcons from "@/components/StatusIcons";
import StatusMessage from "@/components/StatusMessage";
import MeercopCharacter from "@/components/MeercopCharacter";
import ToggleButton from "@/components/ToggleButton";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(true);
  const deviceName = "Laptop1";

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-light to-primary flex flex-col relative overflow-hidden">
      <Header />
      <DeviceSelector deviceName={deviceName} />
      <StatusIcons />
      <StatusMessage deviceName={deviceName} isMonitoring={isMonitoring} />
      <MeercopCharacter />
      <ToggleButton isOn={isMonitoring} onToggle={() => setIsMonitoring(!isMonitoring)} />
    </div>
  );
};

export default Index;
