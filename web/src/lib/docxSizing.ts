export const MM_TO_EMU = 36000
export const PAGE_WIDTH_MM = 163
export const PAGE_WIDTH_EMU = PAGE_WIDTH_MM * MM_TO_EMU

export const PHOTO_WIDTH_MM = 78
export const PHOTO_MAX_HEIGHT_MM = 100
export const PHOTO_GAP_MM = 7

export const DRAWING_WIDTH_MM = 163
export const DRAWING_MAX_HEIGHT_MM = 200

export interface ImageDimensions {
  widthEmu: number
  heightEmu: number
  widthMm: number
  heightMm: number
}

export function getImageDimensions(
  naturalWidth: number,
  naturalHeight: number,
  targetWidthMm: number,
  maxHeightMm: number
): ImageDimensions {
  const aspectRatio = naturalHeight / naturalWidth
  let heightMm = targetWidthMm * aspectRatio
  let widthMm = targetWidthMm

  if (heightMm > maxHeightMm) {
    heightMm = maxHeightMm
    widthMm = heightMm / aspectRatio
  }

  return {
    widthEmu: Math.round(widthMm * MM_TO_EMU),
    heightEmu: Math.round(heightMm * MM_TO_EMU),
    widthMm,
    heightMm,
  }
}

export function getImageNaturalSize(
  buffer: ArrayBuffer
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const blob = new Blob([buffer])
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 800, height: 600 })
    }
    img.src = url
  })
}
