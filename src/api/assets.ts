import { getToken } from "./client";

async function optimizeImage(file: File): Promise<File> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 256 * 1024 || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 40_000_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!webp || webp.type !== 'image/webp' || webp.size >= file.size) return file;
    return new File([webp], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
  } catch { return file; }
  finally { bitmap?.close(); }
}

export async function uploadAsset(file: File): Promise<{ id: string; url: string }> {
  const token = getToken();
  const image = await optimizeImage(file);
  const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": image.type, Authorization: `Bearer ${token || ""}` }, body: image });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "图片上传失败");
  return data;
}

export async function getAssetBlob(path: string): Promise<Blob> {
  const token = getToken();
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token || ""}` } });
  if (!response.ok) throw new Error("图片加载失败");
  return response.blob();
}
