/**
 * The name a captured markup is stored under: drawing-assets/<inspection>/
 * <stem>.png, where the stem is the drawing number with anything awkward
 * replaced by a dash. The stem is also how a markup is identified in a
 * report's attachment selection (lib/attachmentSelection), so the upload,
 * the rebuild, finalising and the report page must all derive it the same
 * way — hence one function. No imports, so the browser can use it too.
 */
export function drawingAssetStem(number: string): string {
  return number.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)
}
