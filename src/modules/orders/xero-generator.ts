import { Order, OrderItem } from "@/types/database";

export interface XeroContact {
  Name: string;
  EmailAddress: string;
  Addresses?: Array<{
    AddressType: "STREET" | "POBOX";
    AddressLine1: string;
    City: string;
    PostalCode: string;
    Country: string;
  }>;
}

export interface XeroLineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string; // e.g. '200' for Sales
  TaxType: string; // e.g. 'OUTPUT2' for 20% standard VAT
  TaxAmount: number;
  LineAmount: number;
}

export interface XeroInvoicePayload {
  Type: "ACCREC"; // Accounts Receivable
  Contact: XeroContact;
  InvoiceNumber: string;
  Reference: string;
  Date: string;
  DueDate: string;
  Status: "AUTHORISED";
  LineAmountTypes: "Exclusive";
  LineItems: XeroLineItem[];
  SubTotal: number;
  TotalTax: number;
  Total: number;
  CurrencyCode: "GBP";
}

/**
 * Transforms an internal W2P Order into a Xero-compliant
 * Accounting API JSON payload (§ 05 & § 14).
 */
export function generateXeroInvoicePayload(order: Order, items?: OrderItem[]): XeroInvoicePayload {
  const invoiceNumber = `INV-${order.order_number}`;
  const now = new Date(order.created_at);
  const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // Net 14 terms

  const lineItems: XeroLineItem[] = items && items.length > 0
    ? items.map((item) => {
        const unitAmount = Number((item.unit_price_cents / 100).toFixed(2));
        const lineAmount = Number((item.total_price_cents / 100).toFixed(2));
        const taxAmount = Number((lineAmount * 0.20).toFixed(2));

        return {
          Description: `${item.product_name} (${item.width_mm}x${item.height_mm}mm, ${item.material})`,
          Quantity: item.quantity,
          UnitAmount: unitAmount,
          AccountCode: "200", // Standard Sales Account
          TaxType: "OUTPUT2", // 20% UK VAT
          TaxAmount: taxAmount,
          LineAmount: lineAmount,
        };
      })
    : [
        {
          Description: `Custom Web-to-Print Order (${order.order_number})`,
          Quantity: 1,
          UnitAmount: Number((order.subtotal_cents / 100).toFixed(2)),
          AccountCode: "200",
          TaxType: "OUTPUT2",
          TaxAmount: Number((order.tax_cents / 100).toFixed(2)),
          LineAmount: Number((order.subtotal_cents / 100).toFixed(2)),
        },
      ];

  return {
    Type: "ACCREC",
    Contact: {
      Name: order.customer_name || "Valued Customer",
      EmailAddress: order.customer_email || "billing@example.com",
      Addresses: [
        {
          AddressType: "STREET",
          AddressLine1: order.shipping_address.line1,
          City: order.shipping_address.city,
          PostalCode: order.shipping_address.postal_code,
          Country: order.shipping_address.country,
        },
      ],
    },
    InvoiceNumber: invoiceNumber,
    Reference: `ORDER-${order.order_number}`,
    Date: now.toISOString().slice(0, 10),
    DueDate: dueDate.toISOString().slice(0, 10),
    Status: "AUTHORISED",
    LineAmountTypes: "Exclusive",
    LineItems: lineItems,
    SubTotal: Number((order.subtotal_cents / 100).toFixed(2)),
    TotalTax: Number((order.tax_cents / 100).toFixed(2)),
    Total: Number((order.total_cents / 100).toFixed(2)),
    CurrencyCode: "GBP",
  };
}
