import z from "zod";
import { PayoutType } from "../../../generated/prisma/enums.js";

export const createTeamPayoutZodSchema = z.object({
    date: z.iso.date("Date must be YYYY-MM-DD"),
    user_id: z.uuid("user_id must be a valid id"),
    // Tie a payout to a project and it counts as that project's team cost.
    // Leave it out for a general salary, which belongs to no single project.
    project_id: z.uuid("project_id must be a valid id").optional().nullable(),
    amount_bdt: z.number("Amount must be a number").positive("Amount must be greater than zero"),
    type: z.enum(PayoutType, "Choose a valid payout type"),
    account_id: z.uuid("account_id must be a valid id"),
    notes: z.string("Notes must be string").optional(),
});

export const updateTeamPayoutZodSchema = createTeamPayoutZodSchema.partial();

export type ICreateTeamPayoutPayload = z.infer<typeof createTeamPayoutZodSchema>;
export type IUpdateTeamPayoutPayload = z.infer<typeof updateTeamPayoutZodSchema>;
