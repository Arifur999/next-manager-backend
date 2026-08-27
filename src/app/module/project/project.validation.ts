import z from "zod";
import { ProjectStatus } from "../../../generated/prisma/enums.js";

export const createProjectZodSchema = z.object({
    client_id: z.uuid("client_id must be a valid id"),
    name: z.string("Name must be string").min(1, "Name is required"),
    // Unique per agency, not globally - two agencies both using "WEB-001" is
    // correct.
    code: z.string("Code must be string").min(1, "Code is required"),
    description: z.string("Description must be string").optional(),
    status: z.enum(ProjectStatus, "Choose a valid status").optional(),
    start_date: z.iso.date("Start date must be YYYY-MM-DD").optional().nullable(),
    end_date: z.iso.date("End date must be YYYY-MM-DD").optional().nullable(),
    // What the client agreed to pay. Always USD - that is what the agency bills.
    contract_value_usd: z.number("Contract value must be a number").nonnegative().optional(),
    notes: z.string("Notes must be string").optional(),
});

export const updateProjectZodSchema = createProjectZodSchema.omit({ code: true }).partial();

export type ICreateProjectPayload = z.infer<typeof createProjectZodSchema>;
export type IUpdateProjectPayload = z.infer<typeof updateProjectZodSchema>;
