import { Prisma } from "../../generated/prisma/client.js";
import { LeadStage } from "../../generated/prisma/enums.js";

/**
 * Appending to a lead's stage history.
 *
 * Every stage move goes through here, from all three places a lead's stage can
 * change: creation, update, and conversion. A move written in only two of them
 * produces a history with holes, and a history with holes is worse than none -
 * it computes a cycle length that looks plausible and is wrong.
 *
 * Always called with the same transaction client as the write that caused it.
 * If the lead update rolls back, the event that claimed it happened must roll
 * back with it.
 */

type RecordArgs = {
    organizationId: string;
    leadId: string;
    /** Null only on creation - there was no stage before the first one. */
    fromStage: LeadStage | null;
    toStage: LeadStage;
    changedBy?: string;
};

export const recordStageMove = async (
    tx: Prisma.TransactionClient,
    { organizationId, leadId, fromStage, toStage, changedBy }: RecordArgs
) => {
    // A "move" to the stage it is already in is not a move. Writing it would
    // add a second entry timestamp for the same stage, and time-in-stage would
    // then measure from the re-save rather than from the arrival.
    if (fromStage === toStage) return;

    await tx.leadStageEvent.create({
        data: {
            organization_id: organizationId,
            lead_id: leadId,
            from_stage: fromStage,
            to_stage: toStage,
            changed_by: changedBy ?? null,
        },
    });
};

/** Stages a deal can still be won from - anything not yet decided. */
export const OPEN_LEAD_STAGES: LeadStage[] = [
    LeadStage.new,
    LeadStage.contacted,
    LeadStage.proposal,
    LeadStage.negotiating,
];
