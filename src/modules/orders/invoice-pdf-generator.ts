import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Order } from "@/types/database";

export async function generateInvoicePdf(order: Order): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait (in points)
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.07, 0.08, 0.1);
  const orange = rgb(1.0, 0.35, 0.12);
  const muted = rgb(0.4, 0.45, 0.5);
  const grayLine = rgb(0.85, 0.88, 0.92);

  // 1. Company Brand Header
  page.drawText("W2P", {
    x: 50,
    y: 770,
    size: 20,
    font: fontHelveticaBold,
    color: orange,
  });

  page.drawText("Commercial Web-to-Print Platform", {
    x: 50,
    y: 752,
    size: 10,
    font: fontHelvetica,
    color: muted,
  });

  page.drawText("VAT REG: GB 987 6543 21 | w2p.co.in", {
    x: 50,
    y: 738,
    size: 8,
    font: fontHelvetica,
    color: muted,
  });

  // Invoice Title & Metadata (Right side)
  page.drawText("TAX INVOICE", {
    x: 420,
    y: 770,
    size: 18,
    font: fontHelveticaBold,
    color: black,
  });

  page.drawText(`Invoice #: INV-${order.order_number}`, {
    x: 420,
    y: 750,
    size: 9,
    font: fontHelveticaBold,
    color: black,
  });

  page.drawText(`Date: ${new Date(order.created_at).toLocaleDateString("en-GB")}`, {
    x: 420,
    y: 736,
    size: 9,
    font: fontHelvetica,
    color: muted,
  });

  page.drawText(`Status: PAID IN FULL (Stripe)`, {
    x: 420,
    y: 722,
    size: 9,
    font: fontHelveticaBold,
    color: rgb(0.06, 0.65, 0.4),
  });

  // Divider
  page.drawLine({
    start: { x: 50, y: 700 },
    end: { x: 545, y: 700 },
    thickness: 1,
    color: grayLine,
  });

  // 2. Bill To Information
  page.drawText("INVOICE TO:", {
    x: 50,
    y: 675,
    size: 9,
    font: fontHelveticaBold,
    color: muted,
  });

  page.drawText(order.customer_name || "Valued Customer", {
    x: 50,
    y: 658,
    size: 11,
    font: fontHelveticaBold,
    color: black,
  });

  page.drawText(order.customer_email || "", {
    x: 50,
    y: 644,
    size: 9,
    font: fontHelvetica,
    color: muted,
  });

  page.drawText(
    `${order.shipping_address.line1}, ${order.shipping_address.city}, ${order.shipping_address.postal_code}`,
    {
      x: 50,
      y: 630,
      size: 9,
      font: fontHelvetica,
      color: muted,
    }
  );

  // 3. Line Items Table Header
  const tableTop = 580;
  page.drawRectangle({
    x: 50,
    y: tableTop - 5,
    width: 495,
    height: 25,
    color: rgb(0.95, 0.96, 0.98),
  });

  page.drawText("Description", { x: 60, y: tableTop + 3, size: 9, font: fontHelveticaBold, color: black });
  page.drawText("Qty", { x: 340, y: tableTop + 3, size: 9, font: fontHelveticaBold, color: black });
  page.drawText("Unit Rate", { x: 400, y: tableTop + 3, size: 9, font: fontHelveticaBold, color: black });
  page.drawText("Line Total", { x: 480, y: tableTop + 3, size: 9, font: fontHelveticaBold, color: black });

  // Line Item Row
  const rowY = tableTop - 30;
  page.drawText(`Custom Print Manufacturing (${order.order_number})`, {
    x: 60,
    y: rowY,
    size: 9,
    font: fontHelvetica,
    color: black,
  });

  page.drawText("1 batch", { x: 340, y: rowY, size: 9, font: fontHelvetica, color: black });
  page.drawText(`£${(order.subtotal_cents / 100).toFixed(2)}`, { x: 400, y: rowY, size: 9, font: fontHelvetica, color: black });
  page.drawText(`£${(order.subtotal_cents / 100).toFixed(2)}`, { x: 480, y: rowY, size: 9, font: fontHelveticaBold, color: black });

  // Table Bottom Divider
  page.drawLine({
    start: { x: 50, y: rowY - 15 },
    end: { x: 545, y: rowY - 15 },
    thickness: 1,
    color: grayLine,
  });

  // 4. Financial Totals (Bottom-Right)
  const totalsY = rowY - 45;
  page.drawText("Net Subtotal (excl. VAT):", { x: 340, y: totalsY, size: 9, font: fontHelvetica, color: muted });
  page.drawText(`£${(order.subtotal_cents / 100).toFixed(2)}`, { x: 480, y: totalsY, size: 9, font: fontHelvetica, color: black });

  page.drawText("VAT @ 20% (Standard UK):", { x: 340, y: totalsY - 18, size: 9, font: fontHelvetica, color: muted });
  page.drawText(`£${(order.tax_cents / 100).toFixed(2)}`, { x: 480, y: totalsY - 18, size: 9, font: fontHelvetica, color: black });

  page.drawRectangle({
    x: 330,
    y: totalsY - 48,
    width: 215,
    height: 24,
    color: rgb(0.95, 0.96, 0.98),
  });

  page.drawText("TOTAL GROSS PAID:", { x: 340, y: totalsY - 40, size: 10, font: fontHelveticaBold, color: black });
  page.drawText(`£${(order.total_cents / 100).toFixed(2)}`, { x: 475, y: totalsY - 40, size: 11, font: fontHelveticaBold, color: orange });

  // 5. Accounting Footnote
  page.drawText("Accounting Integration: Exported to Xero Accounting Schema (ACCREC / Sales 200 / OUTPUT2).", {
    x: 50,
    y: 80,
    size: 8,
    font: fontHelvetica,
    color: muted,
  });

  page.drawText("Thank you for your business. W2P Print House · All rights reserved.", {
    x: 50,
    y: 65,
    size: 8,
    font: fontHelvetica,
    color: muted,
  });

  return await pdfDoc.save();
}
