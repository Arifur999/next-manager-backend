import { Prisma } from "../../generated/prisma/client.js";

/**
 * The kinds of leave a new agency starts with.
 *
 * Called from EVERY path that creates an organization - self sign-up, the
 * console's create-company form, and accepting an agency invite - beside
 * `seedLeadSources` and `seedWorkflowStatuses`. Missing one here is not a
 * cosmetic gap: asking to be away requires picking a kind, so an agency with no
 * kinds cannot request leave at all, and until there was a settings screen it
 * could not fix that from inside the product either.
 *
 * `days_per_year: 0` means uncapped rather than none - the balance reports
 * `remaining: null` for it, and the card says "no limit". Unpaid leave is
 * uncapped on purpose: the reason to record it is that it explains an absence,
 * not that it comes out of an allowance.
 *
 * These numbers are a starting point, not a policy. Every one of them is
 * editable on the Leave Settings screen, which is the point of seeding rather
 * than hard-coding.
 */
const LEAVE_TYPES = [
    { name: "Annual leave", days_per_year: 10, is_paid: true },
    { name: "Sick leave", days_per_year: 7, is_paid: true },
    { name: "Casual leave", days_per_year: 5, is_paid: true },
    { name: "Unpaid leave", days_per_year: 0, is_paid: false },
];

export const seedLeaveTypes = async (tx: Prisma.TransactionClient, organizationId: string) =>
    tx.leaveType.createMany({
        data: LEAVE_TYPES.map((type) => ({ ...type, organization_id: organizationId })),
        // Harmless if this ever runs twice for the same agency: the unique index
        // on (organization, name) is what makes that safe.
        skipDuplicates: true,
    });
