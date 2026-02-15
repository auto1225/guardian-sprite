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

/** 단일 사진 저장 — 항상 파일 다운로드 (공유 시트 사용 안 함) */
export async function saveSinglePhoto(dataUrl: string, filename: string): Promise<void> {
  const blob = dataUrlToBlob(dataUrl);
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

  // 데스크톱: File System Access API로 폴더 한 번 선택 후 일괄 저장
  if ("showDirectoryPicker" in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
      for (const file of files) {
        const fileHandle = await dirHandle.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file);
        await writable.close();
      }
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return;
      // API 미지원 또는 실패 시 아래 폴백
    }
  }

  // 최종 폴백: 개별 다운로드
  for (const file of files) {
    downloadBlob(file, file.name);
  }
}
