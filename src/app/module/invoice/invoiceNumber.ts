/** The invoice number after the highest INV-<n> in use, padded to four digits. */
export const formatInvoiceNumber = (maxSeq: number | null): string =>
    `INV-${String((maxSeq ?? 0) + 1).padStart(4, "0")}`;
