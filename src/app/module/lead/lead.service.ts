import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { ClientStatus, LeadStage } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { OPEN_LEAD_STAGES, recordStageMove } from "../../shared/leadStage.js";
import { escapeLikeTerm, type ListOptions } from "../../shared/listQuery.js";
import { ICreateLeadPayload, IUpdateLeadPayload } from "./lead.validation.js";

/**
 * The sales pipeline.
 *
 * Returned grouped by stage rather than as a flat list, because the screen is a
 * kanban board - handing back one array and making the browser bucket it would
 * just move the same work somewhere slower.
 */

const getPipeline = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.LeadWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(options.search
            ? {
                OR: [
                    { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { company: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { email: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const leads = await prisma.lead.findMany({
        where,
        include: { converted_client: { select: { id: true, name: true } } },
        orderBy: { updated_at: "desc" },
    });

    // Every stage is present even when empty, so the board renders all its
    // columns instead of only the ones that happen to have a card.
    const stages = Object.values(LeadStage).map((stage) => {
        const stageLeads = leads.filter((lead) => lead.stage === stage);
        return {
            stage,
            leads: stageLeads,
            count: stageLeads.length,
            value_usd: stageLeads.reduce(
                (running, lead) => running + lead.estimated_value_usd.toNumber(),
                0
            ),
        };
    });

    const open = leads.filter((lead) => OPEN_LEAD_STAGES.includes(lead.stage));

    return {
        stages,
        total: leads.length,
        // Only open deals count towards the pipeline figure. Folding won and
        // lost into it would make the number grow forever and mean nothing.
        open_value_usd: open.reduce((running, lead) => running + lead.estimated_value_usd.toNumber(), 0),
        open_count: open.length,
    };
};

const createLead = async (payload: ICreateLeadPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
            data: {
                organization_id: user.organizationId,
                name: payload.name,
                company: payload.company ?? "",
                email: payload.email ?? "",
                phone: payload.phone ?? "",
                source: payload.source ?? "",
                stage: payload.stage,
                estimated_value_usd: payload.estimated_value_usd ?? 0,
                notes: payload.notes ?? "",
            },
        });

        // The first stage needs a timestamp too. Without it, a lead created
        // straight into `proposal` has no arrival time for any stage, and its
        // cycle length has nothing to count from.
        await recordStageMove(tx, {
            organizationId: user.organizationId,
            leadId: lead.id,
            fromStage: null,
            toStage: lead.stage,
            changedBy: user.userId,
        });

        return lead;
    });
};

const updateLead = async (id: string, payload: IUpdateLeadPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.lead.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Lead not found");
        }

        const updated = await tx.lead.update({ where: { id }, data: payload });

        // The Lead row only ever knows where it is now. This is the one place
        // that knows where it just came from, so if the move is not written
        // here it is not recoverable afterwards.
        if (payload.stage && payload.stage !== existing.stage) {
            await recordStageMove(tx, {
                organizationId: user.organizationId,
                leadId: id,
                fromStage: existing.stage,
                toStage: payload.stage,
                changedBy: user.userId,
            });
        }

        return updated;
    });
};

/**
 * Turn a won lead into a client.
 *
 * Both writes happen together: a lead marked converted with no client, or a
 * client with the lead still sitting open in the pipeline, are both states
 * somebody would have to notice and fix by hand.
 *
 * The lead is kept rather than deleted - where a client came from is worth
 * being able to answer later.
 */
const convertToClient = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const lead = await tx.lead.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!lead) {
            throw new AppError(status.NOT_FOUND, "Lead not found");
        }

        if (lead.converted_client_id) {
            throw new AppError(status.CONFLICT, "This lead has already been converted");
        }

        const client = await tx.client.create({
            data: {
                organization_id: user.organizationId,
                name: lead.name,
                company: lead.company,
                email: lead.email,
                phone: lead.phone,
                status: ClientStatus.active,
                notes: lead.notes,
            },
        });

        await tx.lead.update({
            where: { id },
            data: {
                stage: LeadStage.won,
                converted_client_id: client.id,
                converted_at: new Date(),
            },
        });

        // Conversion moves the stage to `won` as a side effect, so it is a
        // stage move like any other. Missing it here would leave every deal
        // that was won by converting absent from win-rate and cycle length -
        // which is most of them.
        await recordStageMove(tx, {
            organizationId: user.organizationId,
            leadId: id,
            fromStage: lead.stage,
            toStage: LeadStage.won,
            changedBy: user.userId,
        });

        return client;
    });
};

/**
 * One lead's journey, oldest move first.
 *
 * The Lead row answers "where is it now"; only this answers "how long did
 * each step take", which is what cycle length and velocity are made of.
 */
const getStageEvents = async (id: string, user: IRequestUser) => {
    const lead = await prisma.lead.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!lead) {
        throw new AppError(status.NOT_FOUND, "Lead not found");
    }

    return prisma.leadStageEvent.findMany({
        where: { lead_id: id },
        orderBy: { changed_at: "asc" },
    });
};

const deleteLead = async (id: string, user: IRequestUser) => {
    const existing = await prisma.lead.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Lead not found");
    }

    await prisma.lead.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Lead deleted successfully" };
};

export const LeadService = {
    getPipeline,
    createLead,
    updateLead,
    getStageEvents,
    convertToClient,
    deleteLead,
};
