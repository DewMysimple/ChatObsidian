// A file picker grants access to one image, never a path or directory tree.
// Rasterize a bounded local preview; do not retain the original file location.
export async function prepareCover(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("封面支持 PNG、JPEG 或 WebP 图片。");
  if (file.size > 8 * 1024 * 1024) throw new Error("请选择小于 8 MB 的图片。");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 16000 || bitmap.height > 16000)
      throw new Error("图片尺寸过大，请先缩小图片。");
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理此图片。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/webp", 0.82);
    if (!data.startsWith("data:image/") || data.length > 512 * 1024)
      throw new Error("图片压缩后仍过大，请选择更小的图片。");
    return data;
  } finally {
    bitmap.close();
  }
}
