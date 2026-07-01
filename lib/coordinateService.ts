// ── COORDINATE SERVICE ─────────────────────────────────
// The PDF coordinate is the truth. Screen position is temporary.
//
// Three coordinate spaces:
// 1. Screen coords    — raw touch position on device screen
// 2. Page coords      — position relative to rendered PDF page container
// 3. PDF coords       — stable position in actual PDF page space (0 to pageWidth/Height)
//
// Only PDF coords are saved. Screen/page coords are derived at render time.

export type PdfPoint = { x: number; y: number };

export type PdfViewport = {
  // Position of the PDF page container on screen
  pageLeft: number;
  pageTop: number;
  // Current rendered size of the PDF page
  renderedWidth: number;
  renderedHeight: number;
  // Actual PDF page dimensions in PDF points
  pdfWidth: number;
  pdfHeight: number;
};

// ── STEP 1: Screen → Page ──────────────────────────────
// Remove scroll/pan offset to get position within page container
export function screenToPagePoint(
  screenX: number,
  screenY: number,
  viewport: PdfViewport
): PdfPoint {
  return {
    x: screenX - viewport.pageLeft,
    y: screenY - viewport.pageTop,
  };
}

// ── STEP 2: Page → PDF ────────────────────────────────
// Convert rendered pixel position to PDF coordinate space
// PDF coords are independent of zoom/pan/screen size
export function pageToPdfPoint(
  pageX: number,
  pageY: number,
  viewport: PdfViewport
): PdfPoint {
  return {
    x: (pageX / viewport.renderedWidth) * viewport.pdfWidth,
    y: (pageY / viewport.renderedHeight) * viewport.pdfHeight,
  };
}

// ── COMBINED: Screen → PDF ────────────────────────────
// Use this when handling touch events
export function screenToPdfPoint(
  screenX: number,
  screenY: number,
  viewport: PdfViewport
): PdfPoint {
  const page = screenToPagePoint(screenX, screenY, viewport);
  return pageToPdfPoint(page.x, page.y, viewport);
}

// ── STEP 3: PDF → Page ────────────────────────────────
// Convert PDF coordinates to current rendered page position
// Called every render — output changes with zoom/pan
export function pdfToPagePoint(
  pdfX: number,
  pdfY: number,
  viewport: PdfViewport
): PdfPoint {
  return {
    x: (pdfX / viewport.pdfWidth) * viewport.renderedWidth,
    y: (pdfY / viewport.pdfHeight) * viewport.renderedHeight,
  };
}

// ── STEP 4: PDF → Screen ─────────────────────────────
// Final output for rendering — add page offset
export function pdfToScreenPoint(
  pdfX: number,
  pdfY: number,
  viewport: PdfViewport
): PdfPoint {
  const page = pdfToPagePoint(pdfX, pdfY, viewport);
  return {
    x: viewport.pageLeft + page.x,
    y: viewport.pageTop + page.y,
  };
}

// ── RECT HELPERS ──────────────────────────────────────
export type PdfRect = {
  x: number; y: number; width: number; height: number;
};

// Convert two PDF corner points to a screen rect
export function pdfRectToScreen(
  rect: PdfRect,
  viewport: PdfViewport
): { x: number; y: number; width: number; height: number } {
  const topLeft     = pdfToScreenPoint(rect.x, rect.y, viewport);
  const bottomRight = pdfToScreenPoint(rect.x + rect.width, rect.y + rect.height, viewport);
  return {
    x:      topLeft.x,
    y:      topLeft.y,
    width:  bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

// Convert two screen points to a PDF rect
export function screenRectToPdf(
  startScreen: PdfPoint,
  endScreen: PdfPoint,
  viewport: PdfViewport
): PdfRect {
  const startPdf = screenToPdfPoint(startScreen.x, startScreen.y, viewport);
  const endPdf   = screenToPdfPoint(endScreen.x, endScreen.y, viewport);
  return {
    x:      Math.min(startPdf.x, endPdf.x),
    y:      Math.min(startPdf.y, endPdf.y),
    width:  Math.abs(endPdf.x - startPdf.x),
    height: Math.abs(endPdf.y - startPdf.y),
  };
}

// ── PATH HELPERS ──────────────────────────────────────
// Convert array of PDF points to screen points for SVG rendering
export function pdfPathToScreen(
  points: PdfPoint[],
  viewport: PdfViewport
): PdfPoint[] {
  return points.map(p => pdfToScreenPoint(p.x, p.y, viewport));
}

// Convert array of screen points to PDF points for storage
export function screenPathToPdf(
  points: PdfPoint[],
  viewport: PdfViewport
): PdfPoint[] {
  return points.map(p => screenToPdfPoint(p.x, p.y, viewport));
}

// ── NORMALIZE HELPERS ─────────────────────────────────
// Store as 0-1 fraction of page size for DB storage
// This is resilient to page size changes
export function pdfPointToNorm(p: PdfPoint, viewport: PdfViewport): PdfPoint {
  return {
    x: p.x / viewport.pdfWidth,
    y: p.y / viewport.pdfHeight,
  };
}

export function normToPdfPoint(p: PdfPoint, viewport: PdfViewport): PdfPoint {
  return {
    x: p.x * viewport.pdfWidth,
    y: p.y * viewport.pdfHeight,
  };
}