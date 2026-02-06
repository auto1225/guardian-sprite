import meercopOff from "@/assets/meercop-off.png";
import meercopOn from "@/assets/meercop-on.png";
import meercopAlert from "@/assets/meercop-alert.png";
import mainBg from "@/assets/main-bg.png";

interface MeercopCharacterProps {
  isMonitoring?: boolean;
  isAlert?: boolean;
  statusMessage?: string;
}

const MeercopCharacter = ({ isMonitoring = false, isAlert = false, statusMessage }: MeercopCharacterProps) => {
  const getCharacterImage = () => {
    if (isAlert) return meercopAlert;
    if (isMonitoring) return meercopOn;
    return meercopOff;
  };

  return (
    <>
      {/* 
        LAYER 1: Scene Mask (The Frame)
        - Fixed to bottom 50% of viewport (increased for tall phones)
        - Acts as a window showing only the mountain portion
        - Content aligns to bottom (flex-end)
      */}
      <div 
        className="scene-mask"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '50vh',
          overflow: 'visible',
          display: 'flex',
          alignItems: 'flex-end',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {/* 
          LAYER 2: Content Wrapper (The Content)
          - Relative positioning for absolute children
          - Centers content horizontally
        */}
        <div 
          className="content-wrapper"
          style={{
            width: '100%',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {/* 
            Mountain Background Image
            - Drives the layout height
            - min-width prevents image from becoming too small on mobile
          */}
          <img 
            src={mainBg} 
            alt="Mountain Background" 
            style={{
              width: '100%',
              minWidth: '600px',
              height: 'auto',
              display: 'block',
            }}
          />
          
          {/* 
            Character Group
            - Positioned at 19% from bottom (mountain peak location)
            - Stays glued to mountain regardless of screen size
          */}
          <div 
            className="character-group"
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: '6%', // Lowered further to ground character on mountain peak
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0,
              zIndex: 10,
              pointerEvents: 'auto',
            }}
          >
            {/* Speech Bubble - Glued to character hat */}
            {statusMessage && (
              <div 
                className="w-[85vw] max-w-sm"
                style={{ marginBottom: '-50px' }}
              >
                <div className="bg-card/95 rounded-xl px-4 py-2 shadow-lg">
                  <p className="text-center font-medium text-sm text-card-foreground">
                    {statusMessage}
                  </p>
                </div>
              </div>
            )}
            
            {/* Meerkat Character */}
            <img 
              src={getCharacterImage()} 
              alt="MeerCOP Character" 
              style={{
                width: '18rem',
                maxWidth: '65vw',
                height: 'auto',
                objectFit: 'contain',
                transition: 'all 0.3s',
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default MeercopCharacter;
