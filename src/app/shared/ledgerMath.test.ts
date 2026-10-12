import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../generated/prisma/enums.js";
import { LedgerRow, openPositions } from "./ledgerMath.js";

const row = (
    account_id: string,
    amount: number,
    source_type: LedgerSource = LedgerSource.expense,
    description = "Rent"
): LedgerRow => ({
    account_id,
    currency: Currency.BDT,
    amount: new Prisma.Decimal(amount),
    source_type,
    description,
});

const adjustment = (account_id: string, amount: number) =>
    row(account_id, amount, LedgerSource.adjustment, "Expense edited: Rent");

const amounts = (rows: LedgerRow[]) =>
    openPositions(rows).map((position) => [position.accountId, position.amount.toNumber()]);

describe("openPositions", () => {
    it("a fresh record is open for its full amount", () => {
        assert.deepEqual(amounts([row("bkash", -100)]), [["bkash", -100]]);
    });

    it("after two edits only the latest version is open", () => {
        const rows = [row("bkash", -100), adjustment("bkash", 100), row("bkash", -150), adjustment("bkash", 150), row("bkash", -200)];
        assert.deepEqual(amounts(rows), [["bkash", -200]]);
    });

    it("two edits then a delete nets to zero", () => {
        const rows = [row("bkash", -100), adjustment("bkash", 100), row("bkash", -150), adjustment("bkash", 150), row("bkash", -200)];
        const reversal = openPositions(rows).map((position) => adjustment(position.accountId, position.amount.negated().toNumber()));
        assert.deepEqual(amounts([...rows, ...reversal]), []);
    });

    it("a record moved to another account is open only on the new one", () => {
        const rows = [row("bkash", -100), adjustment("bkash", 100), row("bank", -100)];
        assert.deepEqual(amounts(rows), [["bank", -100]]);
    });

    it("both halves of an exchange are open together", () => {
        const rows = [row("paypal", -50, LedgerSource.exchange_out), row("bkash", 6000, LedgerSource.exchange_in)];
        assert.deepEqual(amounts(rows), [["paypal", -50], ["bkash", 6000]]);
    });

    it("an already reversed source has nothing open", () => {
        assert.deepEqual(amounts([row("bkash", -100), adjustment("bkash", 100)]), []);
    });

    it("the description comes from the latest original entry", () => {
        const rows = [row("bkash", -100, LedgerSource.expense, "Old"), adjustment("bkash", 100), row("bkash", -150, LedgerSource.expense, "New")];
        assert.equal(openPositions(rows)[0].description, "New");
    });
});
