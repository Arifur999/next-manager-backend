import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { ClientStatus, LeadStage } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { escapeLikeTerm, type ListOptions } from "../../shared/listQuery.js";
import { ICreateLeadPayload, IUpdateLeadPayload } from "./lead.validation.js";

/**
 * The sales pipeline.
 *
 * Returned grouped by stage rather than as a flat list, because the screen is a
 * kanban board - handing back one array and making the browser bucket it would
 * just move the same work somewhere slower.
 */

const OPEN_STAGES: LeadStage[] = [
    LeadStage.new,
    LeadStage.contacted,
    LeadStage.proposal,
    LeadStage.negotiating,
];

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

    const open = leads.filter((lead) => OPEN_STAGES.includes(lead.stage));

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
    return prisma.lead.create({
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
};

const updateLead = async (id: string, payload: IUpdateLeadPayload, user: IRequestUser) => {
    const existing = await prisma.lead.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Lead not found");
    }

    return prisma.lead.update({ where: { id }, data: payload });
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

        return client;
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
    convertToClient,
    deleteLead,
};
