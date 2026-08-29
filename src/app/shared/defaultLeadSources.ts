import { Prisma } from "../../generated/prisma/client.js";

/**
 * The marketplaces a new company starts with.
 *
 * Seeded at creation, not left empty. A salesperson recording their first lead
 * should not be met with an empty picker and a detour into settings - and an
 * empty picker is exactly how "source" ends up unrecorded for the first month,
 * which is the month the report most needs.
 *
 * Called from both places a company can be created - self-serve registration
 * and the platform console - through one function, because two copies of a
 * default list is two lists that drift.
 *
 * The list is a starting point, not a fixture: a company adds and retires its
 * own from the Leads screen.
 */
export const DEFAULT_LEAD_SOURCES = ["Upwork", "Fiverr", "Freelancer", "Direct", "Referral"];

export const seedLeadSources = async (tx: Prisma.TransactionClient, organizationId: string) =>
    tx.leadSource.createMany({
        data: DEFAULT_LEAD_SOURCES.map((name) => ({ organization_id: organizationId, name })),
    });
