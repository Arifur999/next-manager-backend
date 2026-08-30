import z from "zod";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";

const invoiceItemZodSchema = z.object({
    // What was sold, when it came from the catalogue. A line typed by hand
    // has no service and always will be a real invoice line.
    service_id: z.uuid("service_id must be a valid id").nullable().optional(),
    description: z.string("Description must be string").min(1, "Description is required"),
    quantity: z.number("Quantity must be a number").positive("Quantity must be greater than zero").optional(),
    unit_price: z.number("Unit price must be a number").nonnegative("Unit price cannot be negative").optional(),
    sort_order: z.number("Sort order must be a number").int().optional(),
});

export const createInvoiceZodSchema = z.object({
    client_id: z.uuid("client_id must be a valid id"),
    project_id: z.uuid("project_id must be a valid id").optional().nullable(),
    // Optional: the server generates INV-0001 style numbers when absent.
    invoice_number: z.string("Invoice number must be string").min(1).optional(),
    issue_date: z.iso.date("Issue date must be YYYY-MM-DD"),
    due_date: z.iso.date("Due date must be YYYY-MM-DD"),
    status: z.enum(InvoiceStatus, "Choose a valid status").optional(),
    discount: z.number("Discount must be a number").nonnegative().optional(),
    tax: z.number("Tax must be a number").nonnegative().optional(),
    // At least one line: an invoice for nothing is a mistake, not a draft.
    items: z.array(invoiceItemZodSchema).min(1, "Add at least one line item"),
    notes: z.string("Notes must be string").optional(),
    terms: z.string("Terms must be string").optional(),
});

// Note there is no subtotal or total here, on either schema. Totals are worked
// out from the line items server-side - a client that sends its own is either
// stale or lying, and either way the figure would land in receivables.
export const updateInvoiceZodSchema = createInvoiceZodSchema
    .omit({ invoice_number: true })
    .partial()
    .extend({
        items: z.array(invoiceItemZodSchema).min(1, "Add at least one line item").optional(),
    });

export type ICreateInvoicePayload = z.infer<typeof createInvoiceZodSchema>;
export type IUpdateInvoicePayload = z.infer<typeof updateInvoiceZodSchema>;
