import { Prisma } from "../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../generated/prisma/enums.js";

export interface LedgerRow {
    account_id: string;
    currency: Currency;
    amount: Prisma.Decimal;
    source_type: LedgerSource;
    description: string;
}

export interface OpenPosition {
    accountId: string;
    currency: Currency;
    amount: Prisma.Decimal;
    description: string;
}

/**
 * What a record still holds on each account, after every earlier reversal.
 * Rows must be in the order they were written, so the description comes from
 * the latest original entry.
 */
export const openPositions = (rows: LedgerRow[]): OpenPosition[] => {
    const byAccount = new Map<string, OpenPosition>();

    for (const row of rows) {
        const position = byAccount.get(row.account_id) ?? {
            accountId: row.account_id,
            currency: row.currency,
            amount: new Prisma.Decimal(0),
            description: "",
        };

        position.amount = position.amount.plus(row.amount);
        if (row.source_type !== LedgerSource.adjustment) {
            position.description = row.description;
        }

        byAccount.set(row.account_id, position);
    }

    return [...byAccount.values()].filter((position) => !position.amount.isZero());
};
