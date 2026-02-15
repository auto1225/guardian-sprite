import { X, Download } from "lucide-react";

interface SnapshotPreviewProps {
  imageUrl: string;
  onClose: () => void;
  onDownload: () => void;
}

const SnapshotPreview = ({ imageUrl, onClose, onDownload }: SnapshotPreviewProps) => {
  return (
    <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-xl">
      <img
        src={imageUrl}
        alt="Snapshot"
        className="max-w-[90%] max-h-[75%] rounded-lg object-contain"
      />
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={onDownload}
          className="w-11 h-11 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          title="다운로드"
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          onClick={onClose}
          className="w-11 h-11 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          title="닫기"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default SnapshotPreview;
