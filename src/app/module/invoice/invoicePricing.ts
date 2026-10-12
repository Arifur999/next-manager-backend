import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";

export interface LineItemInput {
    service_id?: string | null;
    description: string;
    quantity?: number;
    unit_price?: number;
    sort_order?: number;
}

/** Line amounts and the invoice total, worked out server-side. */
export const priceItems = (items: LineItemInput[], discount: number, tax: number) => {
    const priced = items.map((item, index) => {
        const quantity = new Prisma.Decimal(item.quantity ?? 1);
        const unitPrice = new Prisma.Decimal(item.unit_price ?? 0);
        return {
            // Kept on the line, not resolved at read time: what a line was
            // for is a fact about the invoice, and a service renamed later
            // must not restate what was billed.
            service_id: item.service_id ?? null,
            description: item.description,
            quantity,
            unit_price: unitPrice,
            amount: quantity.times(unitPrice).toDecimalPlaces(2),
            sort_order: item.sort_order ?? index,
        };
    });

    const subtotal = priced.reduce(
        (running, item) => running.plus(item.amount),
        new Prisma.Decimal(0)
    );

    const total = subtotal.minus(discount).plus(tax).toDecimalPlaces(2);

    if (total.lessThan(0)) {
        throw new AppError(status.BAD_REQUEST, "The discount cannot be larger than the invoice subtotal");
    }

    return { priced, subtotal: subtotal.toDecimalPlaces(2), total };
};
