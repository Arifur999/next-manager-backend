import assert from "node:assert/strict";
import { describe, it } from "node:test";
import AppError from "../../errorHelpers/AppError.js";
import { priceItems } from "./invoicePricing.js";

describe("priceItems", () => {
    it("prices each line as quantity times unit price, quantity defaulting to 1", () => {
        const { priced, subtotal, total } = priceItems(
            [
                { description: "Logo", unit_price: 250 },
                { description: "Pages", quantity: 3, unit_price: 120.5 },
            ],
            0,
            0
        );

        assert.deepEqual(
            priced.map((line) => [line.quantity.toNumber(), line.amount.toFixed(2)]),
            [
                [1, "250.00"],
                [3, "361.50"],
            ]
        );
        assert.equal(subtotal.toFixed(2), "611.50");
        assert.equal(total.toFixed(2), "611.50");
    });

    it("takes the discount off and adds the tax", () => {
        const { subtotal, total } = priceItems([{ description: "Retainer", quantity: 2, unit_price: 500 }], 100, 45.25);

        assert.equal(subtotal.toFixed(2), "1000.00");
        assert.equal(total.toFixed(2), "945.25");
    });

    it("rounds line amounts to cents", () => {
        const { priced } = priceItems([{ description: "Hours", quantity: 1.333, unit_price: 10 }], 0, 0);
        assert.equal(priced[0].amount.toFixed(), "13.33");
    });

    it("keeps the given order, or the line's position when none is given", () => {
        const { priced } = priceItems(
            [
                { description: "A", sort_order: 5 },
                { description: "B" },
            ],
            0,
            0
        );
        assert.deepEqual(
            priced.map((line) => line.sort_order),
            [5, 1]
        );
        assert.equal(priced[1].service_id, null);
        assert.equal(priced[1].unit_price.toNumber(), 0);
    });

    it("refuses a discount larger than the subtotal", () => {
        assert.throws(
            () => priceItems([{ description: "Logo", unit_price: 100 }], 150, 0),
            (error: unknown) => error instanceof AppError && error.statusCode === 400
        );
    });

    it("allows a discount equal to the subtotal", () => {
        assert.equal(priceItems([{ description: "Logo", unit_price: 100 }], 100, 0).total.toFixed(2), "0.00");
    });
});
