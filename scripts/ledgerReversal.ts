/**
 * Edits and deletes of money records leave every account balanced.
 *
 * Each record is created, edited twice and deleted, and the account balance is
 * read after every step. An instalment is paid, reversed, paid and reversed.
 *
 * Run:  npm run test:ledger   (with the server up)
 */

import { prisma } from "../src/app/lib/prisma.js";

const BASE = "http://localhost:5000/api/v1";
const stamp = Date.now();
const email = `ledger${stamp}@agencio.test`;
const organizationName = `E2E ledger ${stamp}`;
let failures = 0;

type Json = Record<string, unknown> & { data?: Record<string, unknown> & { id?: string } };

const call = async (method: string, path: string, body?: unknown, cookie = "") => {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as Json,
        cookie: setCookie.map((c) => c.split(";")[0]).join("; "),
    };
};

const check = (label: string, condition: boolean, detail = "") => {
    if (condition) {
        console.log(`  PASS  ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

await call("POST", "/auth/register", {
    organization_name: organizationName,
    full_name: "Ledger Owner",
    email,
    password: "Passw0rd123",
});
const cookie = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;

const balanceOf = async (accountId: string) => {
    const accounts = (await call("GET", "/accounts", undefined, cookie)).json.data as unknown as {
        id: string;
        balance: number;
    }[];
    return accounts.find((account) => account.id === accountId)?.balance;
};

/** Runs the steps in order and compares the balance after each with what it should be. */
const walk = async (label: string, accountId: string, steps: { run: () => Promise<unknown>; expected: number }[]) => {
    const seen: (number | undefined)[] = [];
    for (const step of steps) {
        await step.run();
        seen.push(await balanceOf(accountId));
    }
    const expected = steps.map((step) => step.expected);
    console.log(`  ${label}: ${seen.join(", ")}`);
    check(`${label} balances after every step`, JSON.stringify(seen) === JSON.stringify(expected), `expected ${expected.join(", ")}`);
};

try {
    const bdt = (await call("POST", "/accounts", { name: "BDT", type: "bkash", currency: "BDT" }, cookie)).json.data;
    const usd = (await call("POST", "/accounts", { name: "USD", type: "paypal", currency: "USD" }, cookie)).json.data;
    const category = (await call("POST", "/expense-categories", { name: "Rent", type: "general" }, cookie)).json.data;
    const client = (await call("POST", "/clients", { name: "Ledger Client" }, cookie)).json.data;
    const me = (await call("GET", "/auth/me", undefined, cookie)).json.data;

    check("fixtures created", Boolean(bdt?.id && usd?.id && category?.id && client?.id && me?.id));
    const bdtId = String(bdt?.id);
    const usdId = String(usd?.id);

    let expenseId = "";
    await walk("expense", bdtId, [
        {
            run: async () => {
                const res = await call("POST", "/expenses", { date: "2026-09-01", category_id: category?.id, amount_bdt: 100, account_id: bdtId }, cookie);
                expenseId = String(res.json.data?.id);
            },
            expected: -100,
        },
        { run: () => call("PATCH", `/expenses/${expenseId}`, { amount_bdt: 150 }, cookie), expected: -150 },
        { run: () => call("PATCH", `/expenses/${expenseId}`, { amount_bdt: 200 }, cookie), expected: -200 },
        { run: () => call("DELETE", `/expenses/${expenseId}`, undefined, cookie), expected: 0 },
    ]);

    let paymentId = "";
    await walk("payment", usdId, [
        {
            run: async () => {
                const res = await call("POST", "/payments", { client_id: client?.id, date: "2026-09-01", amount_usd: 100, reporting_rate: 120, account_id: usdId }, cookie);
                paymentId = String(res.json.data?.id);
            },
            expected: 100,
        },
        { run: () => call("PATCH", `/payments/${paymentId}`, { amount_usd: 150 }, cookie), expected: 150 },
        { run: () => call("PATCH", `/payments/${paymentId}`, { amount_usd: 200 }, cookie), expected: 200 },
        { run: () => call("DELETE", `/payments/${paymentId}`, undefined, cookie), expected: 0 },
    ]);

    let payoutId = "";
    await walk("payout", bdtId, [
        {
            run: async () => {
                const res = await call("POST", "/team-payouts", { date: "2026-09-01", user_id: me?.id, amount_bdt: 100, type: "salary", account_id: bdtId }, cookie);
                payoutId = String(res.json.data?.id);
            },
            expected: -100,
        },
        { run: () => call("PATCH", `/team-payouts/${payoutId}`, { amount_bdt: 150 }, cookie), expected: -150 },
        { run: () => call("PATCH", `/team-payouts/${payoutId}`, { amount_bdt: 200 }, cookie), expected: -200 },
        { run: () => call("DELETE", `/team-payouts/${payoutId}`, undefined, cookie), expected: 0 },
    ]);

    // No account on the loan itself, so only the repayments move the balance.
    const loan = (await call("POST", "/loans", { lender: "Bank", principal_bdt: 1000, started_on: "2026-09-01", term_months: 2 }, cookie)).json.data;
    const instalments = (loan?.instalments ?? []) as { id: string; principal_bdt: number; interest_bdt: number }[];
    const first = instalments[0];
    check("loan created with a schedule", Boolean(first?.id));
    const due = -((first?.principal_bdt ?? 0) + (first?.interest_bdt ?? 0));

    await walk("instalment", bdtId, [
        { run: () => call("PATCH", `/loans/instalments/${first?.id}/pay`, { account_id: bdtId }, cookie), expected: due },
        { run: () => call("PATCH", `/loans/instalments/${first?.id}/reverse`, undefined, cookie), expected: 0 },
        { run: () => call("PATCH", `/loans/instalments/${first?.id}/pay`, { account_id: bdtId }, cookie), expected: due },
        { run: () => call("PATCH", `/loans/instalments/${first?.id}/reverse`, undefined, cookie), expected: 0 },
    ]);
} finally {
    // Money rows restrict their account and client, so they go before the company.
    const organization = await prisma.organization.findFirst({ where: { name: organizationName }, select: { id: true } });
    const where = { organization_id: organization?.id ?? "" };
    await prisma.loanInstalment.deleteMany({ where });
    await prisma.loan.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.expense.deleteMany({ where });
    await prisma.teamPayout.deleteMany({ where });
    await prisma.organization.deleteMany({ where: { name: organizationName } });
    await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "LEDGER BALANCES HOLD" : `${failures} PROBLEM(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
