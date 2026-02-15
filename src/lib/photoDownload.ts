import JSZip from "jszip";

/** base64 dataURL → Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 단일 사진 저장 (모바일: Share API, 데스크톱: <a> download) */
export async function saveSinglePhoto(dataUrl: string, filename: string): Promise<void> {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return; // user cancelled
    }
  }

  // Fallback: <a> download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 여러 사진을 ZIP으로 묶어 저장 (모바일: Share API, 데스크톱: <a> download) */
export async function savePhotosAsZip(
  photos: string[],
  eventType: string,
  indices?: number[]
): Promise<void> {
  const selected = indices
    ? indices.map((i) => ({ photo: photos[i], idx: i }))
    : photos.map((photo, i) => ({ photo, idx: i }));

  // 모바일에서 단일 사진이면 직접 공유
  if (selected.length === 1) {
    const { photo, idx } = selected[0];
    return saveSinglePhoto(photo, `meercop-${eventType}_${idx + 1}.jpg`);
  }

  // 모바일: 여러 파일 공유 시도
  const files = selected.map(
    ({ photo, idx }) =>
      new File([dataUrlToBlob(photo)], `meercop-${eventType}_${idx + 1}.jpg`, {
        type: "image/jpeg",
      })
  );

  if (navigator.share && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return;
      // 공유 실패 시 ZIP 폴백
    }
  }

  // ZIP 폴백
  const zip = new JSZip();
  selected.forEach(({ photo, idx }) => {
    const blob = dataUrlToBlob(photo);
    zip.file(`meercop-${eventType}_${idx + 1}.jpg`, blob);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const zipFile = new File([zipBlob], `meercop-${eventType}.zip`, {
    type: "application/zip",
  });

  // ZIP도 Share API 시도
  if (navigator.share && navigator.canShare?.({ files: [zipFile] })) {
    try {
      await navigator.share({ files: [zipFile] });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return;
    }
  }

  // 최종 폴백: <a> download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meercop-${eventType}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
