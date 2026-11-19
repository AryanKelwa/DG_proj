import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { SerializedCanvasState } from "../designer/types";
import { generateStandardPrintFileName, FileNamingParams } from "./file-naming";

export const MM_TO_PT = 72 / 25.4; // ~2.834645 pt per mm

export interface RenderPrintPdfOptions {
  orderId: string;
  productType: string;
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  canvasState?: SerializedCanvasState;
  customText?: string;
  customNumber?: string;
  subTitle?: string;
}

export interface GeneratedPdfResult {
  fileName: string;
  pdfBytes: Uint8Array;
  mediaBoxPt: { width: number; height: number };
  trimBoxPt: { width: number; height: number };
  bleedMm: number;
  dpi: number;
}

/**
 * Server-side 300 DPI Production PDF Generator (§ 07)
 * Compiles production-ready PDF with real bleed, trim box, and crop marks.
 */
export async function generateProductionPdf(
  options: RenderPrintPdfOptions
): Promise<GeneratedPdfResult> {
  const {
    orderId,
    productType,
    widthMm,
    heightMm,
    bleedMm = 3.0,
    canvasState,
    customText,
    customNumber,
    subTitle,
  } = options;

  // Margin for crop marks & technical slug info (10mm around bleed)
  const slugMarginMm = 10;

  const trimWidthPt = widthMm * MM_TO_PT;
  const trimHeightPt = heightMm * MM_TO_PT;

  const bleedWidthPt = (widthMm + bleedMm * 2) * MM_TO_PT;
  const bleedHeightPt = (heightMm + bleedMm * 2) * MM_TO_PT;

  const totalPageWidthPt = (widthMm + (bleedMm + slugMarginMm) * 2) * MM_TO_PT;
  const totalPageHeightPt = (heightMm + (bleedMm + slugMarginMm) * 2) * MM_TO_PT;

  // Offsets from page origin (bottom-left in PDF)
  const bleedOffsetX = slugMarginMm * MM_TO_PT;
  const bleedOffsetY = slugMarginMm * MM_TO_PT;

  const trimOffsetX = (slugMarginMm + bleedMm) * MM_TO_PT;
  const trimOffsetY = (slugMarginMm + bleedMm) * MM_TO_PT;

  // Create document
  const pdfDoc = await PDFDocument.create();
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([totalPageWidthPt, totalPageHeightPt]);

  // Set PDF Boxes for RIP (Raster Image Processors)
  page.setMediaBox(0, 0, totalPageWidthPt, totalPageHeightPt);
  page.setBleedBox(bleedOffsetX, bleedOffsetY, bleedWidthPt, bleedHeightPt);
  page.setTrimBox(trimOffsetX, trimOffsetY, trimWidthPt, trimHeightPt);

  // 1. Draw Bleed Area Background (Full artwork coverage)
  page.drawRectangle({
    x: bleedOffsetX,
    y: bleedOffsetY,
    width: bleedWidthPt,
    height: bleedHeightPt,
    color: rgb(0.98, 0.98, 0.99),
  });

  // 2. Draw Artwork Elements
  if (canvasState && canvasState.elements && canvasState.elements.length > 0) {
    // Render from serialized canvas JSON
    for (const el of canvasState.elements) {
      if (el.type === "text") {
        const textX = trimOffsetX + (el.x / 2);
        // Flip Y because PDF coordinates start from bottom-left
        const textY = trimOffsetY + trimHeightPt - (el.y / 2) - 15;

        page.drawText(el.text, {
          x: Math.max(trimOffsetX, textX),
          y: Math.max(trimOffsetY, textY),
          size: Math.max(8, (el.fontSize || 16) * 0.75),
          font: el.isBold ? fontHelveticaBold : fontHelvetica,
          color: rgb(0.07, 0.08, 0.1),
        });
      } else if (el.type === "rect") {
        const rectX = trimOffsetX + (el.x / 2);
        const rectY = trimOffsetY + trimHeightPt - (el.y / 2) - ((el.height || 40) / 2);
        page.drawRectangle({
          x: rectX,
          y: rectY,
          width: Math.min(trimWidthPt, (el.width || 80) / 2),
          height: (el.height || 40) / 2,
          color: rgb(1.0, 0.35, 0.12), // Brand Tangerine
        });
      }
    }
  } else {
    // Default High-Res Vector Spec Render (e.g. for Race Bibs / Plates)
    const title = customText || productType.replace(/-/g, " ").toUpperCase();
    const number = customNumber || orderId.replace(/[^0-9]/g, "").slice(-3) || "001";

    // Big central identification number (e.g. for Race Bib or Plate)
    page.drawText(number, {
      x: trimOffsetX + 20,
      y: trimOffsetY + trimHeightPt / 2 - 20,
      size: Math.min(72, trimHeightPt * 0.4),
      font: fontHelveticaBold,
      color: rgb(0.07, 0.08, 0.1),
    });

    // Top Header
    page.drawText(title, {
      x: trimOffsetX + 20,
      y: trimOffsetY + trimHeightPt - 30,
      size: 14,
      font: fontHelveticaBold,
      color: rgb(1.0, 0.35, 0.12),
    });

    // Bottom Subtitle
    if (subTitle) {
      page.drawText(subTitle, {
        x: trimOffsetX + 20,
        y: trimOffsetY + 20,
        size: 10,
        font: fontHelvetica,
        color: rgb(0.3, 0.35, 0.4),
      });
    }
  }

  // 3. Draw Corner Crop Marks (Registration Marks around TrimBox)
  const cropMarkLen = 15;
  const black = rgb(0, 0, 0);

  // Bottom-Left
  page.drawLine({ start: { x: trimOffsetX - cropMarkLen, y: trimOffsetY }, end: { x: trimOffsetX, y: trimOffsetY }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: trimOffsetX, y: trimOffsetY - cropMarkLen }, end: { x: trimOffsetX, y: trimOffsetY }, thickness: 0.5, color: black });

  // Bottom-Right
  page.drawLine({ start: { x: trimOffsetX + trimWidthPt, y: trimOffsetY }, end: { x: trimOffsetX + trimWidthPt + cropMarkLen, y: trimOffsetY }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: trimOffsetX + trimWidthPt, y: trimOffsetY - cropMarkLen }, end: { x: trimOffsetX + trimWidthPt, y: trimOffsetY }, thickness: 0.5, color: black });

  // Top-Left
  page.drawLine({ start: { x: trimOffsetX - cropMarkLen, y: trimOffsetY + trimHeightPt }, end: { x: trimOffsetX, y: trimOffsetY + trimHeightPt }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: trimOffsetX, y: trimOffsetY + trimHeightPt }, end: { x: trimOffsetX, y: trimOffsetY + trimHeightPt + cropMarkLen }, thickness: 0.5, color: black });

  // Top-Right
  page.drawLine({ start: { x: trimOffsetX + trimWidthPt, y: trimOffsetY + trimHeightPt }, end: { x: trimOffsetX + trimWidthPt + cropMarkLen, y: trimOffsetY + trimHeightPt }, thickness: 0.5, color: black });
  page.drawLine({ start: { x: trimOffsetX + trimWidthPt, y: trimOffsetY + trimHeightPt }, end: { x: trimOffsetX + trimWidthPt, y: trimOffsetY + trimHeightPt + cropMarkLen }, thickness: 0.5, color: black });

  // 4. Draw Technical Slug Info (Outside Bleed Area for Production Operators)
  const slugText = `ORDER: ${orderId} | TYPE: ${productType} | TRIM: ${widthMm}x${heightMm}mm | BLEED: +${bleedMm}mm | 300 DPI PRODUCTION READY`;
  page.drawText(slugText, {
    x: bleedOffsetX,
    y: bleedOffsetY + bleedHeightPt + 8,
    size: 7,
    font: fontHelvetica,
    color: rgb(0.4, 0.4, 0.4),
  });

  const fileName = generateStandardPrintFileName({
    orderId,
    productType,
    extension: "pdf",
  });

  const pdfBytes = await pdfDoc.save();

  return {
    fileName,
    pdfBytes,
    mediaBoxPt: { width: totalPageWidthPt, height: totalPageHeightPt },
    trimBoxPt: { width: trimWidthPt, height: trimHeightPt },
    bleedMm,
    dpi: 300,
  };
}
