import z from "zod";
import { ClientStatus } from "../../../generated/prisma/enums.js";

export const createClientZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    company: z.string("Company must be string").optional(),
    email: z.email("Enter a valid email address").optional().or(z.literal("")),
    phone: z.string("Phone must be string").optional(),
    country: z.string("Country must be string").optional(),
    status: z.enum(ClientStatus, "Choose a valid status").optional(),
    notes: z.string("Notes must be string").optional(),
    // Who brought them in. Left out, it is the person entering them - which
    // is the honest record. An admin filing a client on somebody else's
    // behalf names them instead.
    owner_id: z.uuid("owner_id must be a valid id").nullable().optional(),
});

export const updateClientZodSchema = createClientZodSchema.partial();

export type ICreateClientPayload = z.infer<typeof createClientZodSchema>;
export type IUpdateClientPayload = z.infer<typeof updateClientZodSchema>;
