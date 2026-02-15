/** base64 dataURL → Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 단일 사진 저장 */
export async function saveSinglePhoto(dataUrl: string, filename: string): Promise<void> {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], filename, { type: blob.type });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

/** 여러 사진을 개별 파일로 저장 (모바일: Share API 묶음 공유, 데스크톱: 순차 다운로드) */
export async function savePhotos(
  photos: string[],
  eventType: string,
  indices?: number[]
): Promise<void> {
  const selected = indices
    ? indices.map((i) => ({ photo: photos[i], idx: i }))
    : photos.map((photo, i) => ({ photo, idx: i }));

  if (selected.length === 0) return;

  // 파일 객체 생성
  const files = selected.map(
    ({ photo, idx }) =>
      new File([dataUrlToBlob(photo)], `meercop-${eventType}_${idx + 1}.jpg`, {
        type: "image/jpeg",
      })
  );

  // 모바일: Web Share API로 묶음 공유 (카카오톡 묶음저장처럼 개별 사진으로 저장됨)
  if (navigator.share && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return;
      // 공유 실패 시 아래 폴백
    }
  }

  // 데스크톱 폴백: 개별 다운로드 (한번에 처리)
  for (const file of files) {
    downloadBlob(file, file.name);
  }
}
