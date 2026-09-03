import { Prisma } from "../../generated/prisma/client.js";
import { StatusCategory, WorkflowKind } from "../../generated/prisma/enums.js";

/**
 * The boards a new agency starts with.
 *
 * Called from EVERY path that creates an organization - self sign-up, the
 * console's create-company form, and accepting an agency invite. Missing one is
 * the bug that shipped with LeadSource, where new sign-ups got an empty picker;
 * here it is worse, because an agency with no statuses cannot create a task at
 * all.
 *
 * The names are theirs to change. The categories are what the code reasons
 * about, so a renamed "Done" still stops the clock.
 */

const TASK_STATUSES = [
    { name: "To do", category: StatusCategory.open, sort_order: 0, is_default: true },
    { name: "In progress", category: StatusCategory.active, sort_order: 1, is_default: false },
    { name: "In review", category: StatusCategory.active, sort_order: 2, is_default: false },
    { name: "Done", category: StatusCategory.done, sort_order: 3, is_default: false },
];

const PROJECT_STATUSES = [
    { name: "Planning", category: StatusCategory.open, sort_order: 0, is_default: true },
    { name: "Active", category: StatusCategory.active, sort_order: 1, is_default: false },
    // Work that is done but not signed off. Category `active` on purpose: it is
    // not finished, so it must keep counting as in-flight everywhere the code
    // reasons about category rather than name - a Review that read as `done`
    // would quietly close projects nobody had accepted.
    { name: "Review", category: StatusCategory.active, sort_order: 2, is_default: false },
    { name: "On hold", category: StatusCategory.blocked, sort_order: 3, is_default: false },
    { name: "Completed", category: StatusCategory.done, sort_order: 4, is_default: false },
    { name: "Cancelled", category: StatusCategory.cancelled, sort_order: 5, is_default: false },
];

export const seedWorkflowStatuses = async (
    tx: Prisma.TransactionClient,
    organizationId: string
) =>
    tx.workflowStatus.createMany({
        data: [
            ...TASK_STATUSES.map((status) => ({
                ...status,
                kind: WorkflowKind.task,
                organization_id: organizationId,
            })),
            ...PROJECT_STATUSES.map((status) => ({
                ...status,
                kind: WorkflowKind.project,
                organization_id: organizationId,
            })),
        ],
        // Harmless if this ever runs twice for the same agency: the unique index
        // on (organization, kind, name) is what makes that safe.
        skipDuplicates: true,
    });

/**
 * The status a new task or project lands on.
 *
 * Falls back to the first one on the board when nobody has marked a default, so
 * an agency that deleted its default still gets work created rather than an
 * error nobody can act on.
 */
export const defaultStatusId = async (
    tx: Prisma.TransactionClient,
    organizationId: string,
    kind: WorkflowKind
) => {
    const status = await tx.workflowStatus.findFirst({
        where: { organization_id: organizationId, kind, is_active: true },
        orderBy: [{ is_default: "desc" }, { sort_order: "asc" }],
        select: { id: true },
    });

    return status?.id ?? null;
};
