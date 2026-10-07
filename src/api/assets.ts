import { getToken } from "./client";

export async function uploadAsset(file: File): Promise<{ id: string; url: string }> {
  const token = getToken();
  const response = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": file.type, Authorization: `Bearer ${token || ""}` }, body: file });
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
