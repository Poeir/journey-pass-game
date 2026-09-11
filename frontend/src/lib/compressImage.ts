// Memory wall renders at w_400 (grid) / w_900 (hover popup) via Cloudinary
// transforms, so 1024 is the largest source we ever actually display. Going
// from 1280 → 1024 cuts canvas pixel work by ~36% (1024² vs 1280²) and
// shrinks each upload — both matter when 200 attendees photograph at once
// on flaky on-site WiFi.
const MAX_DIMENSION = 1024;
const QUALITY = 0.8;

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const targetW = Math.round(img.width * scale);
  const targetH = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );
  if (!blob) return file;

  return new File([blob], replaceExt(file.name, 'jpg'), { type: 'image/jpeg' });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function replaceExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? `${name}.${ext}` : `${name.slice(0, dot)}.${ext}`;
}
