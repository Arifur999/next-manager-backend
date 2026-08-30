import z from "zod";
import { StatusCategory, WorkflowKind } from "../../../generated/prisma/enums.js";

export const createWorkflowStatusZodSchema = z.object({
    kind: z.enum(WorkflowKind, "Choose a board"),
    name: z
        .string("Name must be a string")
        .min(1, "Give it a name")
        .max(40, "That is longer than a column heading"),
    // Required, and deliberately never guessed from the name. A status whose
    // meaning was inferred would quietly change meaning the day somebody
    // edited its label.
    category: z.enum(StatusCategory, "Say what this status means"),
    sort_order: z.number("Order must be a number").int().min(0).optional(),
    is_default: z.boolean("is_default must be true or false").optional(),
});

export const updateWorkflowStatusZodSchema = createWorkflowStatusZodSchema
    .omit({ kind: true })
    .partial()
    .extend({ is_active: z.boolean("is_active must be true or false").optional() });

export type ICreateWorkflowStatusPayload = z.infer<typeof createWorkflowStatusZodSchema>;
export type IUpdateWorkflowStatusPayload = z.infer<typeof updateWorkflowStatusZodSchema>;
