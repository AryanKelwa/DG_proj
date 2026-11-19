/**
 * Standardized File Naming & Directory Structure (§ 07):
 * Outputs follow a predictable naming convention and are grouped in order-based directories:
 * Folder: /orders/[OrderID]/
 * File: OrderID_ProductType_Date_Output.[pdf|png]
 */

export interface FileNamingParams {
  orderId: string;
  productType: string;
  extension?: "pdf" | "png" | "zip";
  date?: Date;
}

export function sanitizeSlug(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function generateStandardPrintFileName(params: FileNamingParams): string {
  const { orderId, productType, extension = "pdf", date = new Date() } = params;

  // Format date as YYYYMMDD
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");

  const cleanOrderId = sanitizeSlug(orderId);
  const cleanProductType = sanitizeSlug(productType);

  return `${cleanOrderId}_${cleanProductType}_${dateStr}_Output.${extension}`;
}

export function generateStandardOrderDirectory(orderId: string): string {
  const cleanOrderId = sanitizeSlug(orderId);
  return `/orders/${cleanOrderId}/`;
}

export function getFullStandardFilePath(params: FileNamingParams): string {
  const dir = generateStandardOrderDirectory(params.orderId);
  const filename = generateStandardPrintFileName(params);
  return `${dir}${filename}`;
}
