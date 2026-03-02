// Streaming quality presets
export type StreamingQuality = "vga" | "hd" | "fhd";

export const QUALITY_CONSTRAINTS: Record<StreamingQuality, MediaTrackConstraints> = {
  vga: {
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 15, max: 30 },
    facingMode: "user",
  },
  hd: {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user",
  },
  fhd: {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user",
  },
};

export function getVideoConstraints(quality?: string): MediaTrackConstraints {
  const q = (quality || "vga") as StreamingQuality;
  return QUALITY_CONSTRAINTS[q] || QUALITY_CONSTRAINTS.vga;
}
