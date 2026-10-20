export async function preparePhoto(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw Error("Escolha PNG, JPEG ou WebP de até 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (
      bitmap.width > 8192 ||
      bitmap.height > 8192 ||
      bitmap.width * bitmap.height > 24000000
    )
      throw Error("A imagem deve ter até 8192 px / 24 megapixels.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const size = Math.min(bitmap.width, bitmap.height);
    canvas
      .getContext("2d")!
      .drawImage(
        bitmap,
        (bitmap.width - size) / 2,
        (bitmap.height - size) / 2,
        size,
        size,
        0,
        0,
        128,
        128,
      );
    const image = canvas.toDataURL("image/webp", 0.8);
    if (image.length > 43720)
      throw Error("Não foi possível reduzir a imagem para 32 KB.");
    return image;
  } finally {
    bitmap.close();
  }
}
