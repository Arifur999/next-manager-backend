/**
 * Lists money records whose ledger rows no longer add up to what the record says.
 *
 * Before the reversal fix, a record edited twice (or edited, then deleted) was
 * reversed more than once, so its account balance is off. This only reads.
 * Correcting a row is an operator decision: one adjustment row per line printed.
 *
 * Run:  npm run ledger:drift
 */

import { prisma } from "../src/app/lib/prisma.js";

type DriftRow = {
    organization: string;
    source: string;
    id: string;
    account: string;
    expected: string;
    actual: string;
    diff: string;
};

// Expected: what each record should hold on each account today. A deleted,
// reversed or unpaid record should hold nothing, so it contributes no row here
// and any non-zero ledger sum against it shows up as drift.
const rows = await prisma.$queryRaw<DriftRow[]>`
    WITH expected AS (
        SELECT organization_id, 'payment' AS source, id, account_id, amount_usd AS amount
            FROM payments WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'expense', id, account_id, -amount_bdt
            FROM expenses WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'team_payout', id, account_id, -amount_bdt
            FROM team_payouts WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'owner_withdrawal', id, account_id, -amount_bdt
            FROM owner_withdrawals WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'due_transaction', id, account_id,
               CASE WHEN direction = 'received' THEN amount_bdt ELSE -amount_bdt END
            FROM due_transactions WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'exchange', id, from_account_id, -amount_usd
            FROM exchange_transactions WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'exchange', id, to_account_id, amount_bdt
            FROM exchange_transactions WHERE deleted_at IS NULL
        UNION ALL
        SELECT organization_id, 'loan', id, account_id, principal_bdt
            FROM loans WHERE deleted_at IS NULL AND account_id IS NOT NULL
        UNION ALL
        SELECT organization_id, 'loan_instalment', id, paid_from_account_id, -(principal_bdt + interest_bdt)
            FROM loan_instalments WHERE paid_at IS NOT NULL
        UNION ALL
        SELECT organization_id, 'shareholder_distribution', id, account_id, -amount_bdt
            FROM shareholder_distributions WHERE deleted_at IS NULL
    ),
    sources AS (
        SELECT id, 'payment' AS source FROM payments
        UNION ALL SELECT id, 'expense' FROM expenses
        UNION ALL SELECT id, 'team_payout' FROM team_payouts
        UNION ALL SELECT id, 'owner_withdrawal' FROM owner_withdrawals
        UNION ALL SELECT id, 'due_transaction' FROM due_transactions
        UNION ALL SELECT id, 'exchange' FROM exchange_transactions
        UNION ALL SELECT id, 'loan' FROM loans
        UNION ALL SELECT id, 'loan_instalment' FROM loan_instalments
        UNION ALL SELECT id, 'shareholder_distribution' FROM shareholder_distributions
    ),
    actual AS (
        SELECT t.organization_id, s.source, t.source_id AS id, t.account_id, SUM(t.amount) AS amount
            FROM account_transactions t
            JOIN sources s ON s.id = t.source_id
            GROUP BY t.organization_id, s.source, t.source_id, t.account_id
    )
    SELECT o.name AS organization,
           COALESCE(e.source, a.source) AS source,
           COALESCE(e.id, a.id) AS id,
           COALESCE(e.account_id, a.account_id) AS account,
           COALESCE(e.amount, 0)::text AS expected,
           COALESCE(a.amount, 0)::text AS actual,
           (COALESCE(a.amount, 0) - COALESCE(e.amount, 0))::text AS diff
        FROM expected e
        FULL OUTER JOIN actual a ON a.id = e.id AND a.account_id = e.account_id
        JOIN organizations o ON o.id = COALESCE(e.organization_id, a.organization_id)
        WHERE COALESCE(a.amount, 0) <> COALESCE(e.amount, 0)
        ORDER BY o.name, source, id
`;

if (rows.length === 0) {
    console.log("No drift: every money record matches its ledger rows.");
} else {
    console.table(rows);
    console.log(`${rows.length} record/account pair(s) drifted.`);
}

await prisma.$disconnect();
