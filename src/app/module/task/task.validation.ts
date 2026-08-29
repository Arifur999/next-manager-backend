import z from "zod";
import { Role } from "../../../generated/prisma/enums.js";
import { TaskPriority, TaskStatus } from "../../../generated/prisma/enums.js";

export const createTaskZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    title: z.string("Title must be string").min(1, "Title is required"),
    description: z.string("Description must be string").optional(),
    assignee_id: z.uuid("assignee_id must be a valid id").optional().nullable(),
    status: z.enum(TaskStatus, "Choose a valid status").optional(),
    priority: z.enum(TaskPriority, "Choose a valid priority").optional(),
    due_date: z.iso.date("Due date must be YYYY-MM-DD").optional().nullable(),
});

// completed_at is deliberately not accepted on either schema - it is derived
// from status in the service, because two fields that must agree will not.
export const updateTaskZodSchema = createTaskZodSchema.partial();

/**
 * What operations may change about their own task.
 *
 * Tasks are already scoped to the assignee, so an operations user can only
 * reach their own - but within it the full update schema let them move
 * `due_date`, hand the work to somebody else via `assignee_id`, re-prioritise
 * it, or move it to another project. Every one of those edits the commitment
 * they are being measured against.
 *
 * That is the same hole the milestone due-date freeze already closed. Leaving
 * it open here while closing it there is worse than closing neither, because
 * the pattern looks handled.
 *
 * `.strict()` rather than stripping: somebody trying to move their own
 * deadline should be told no and who to ask, not have the field silently
 * dropped and the save reported as a success.
 */
export const updateOwnTaskZodSchema = z
    .object({
        status: z.enum(TaskStatus, "Choose a valid status").optional(),
        description: z.string("Description must be string").optional(),
    })
    .strict();

/**
 * The schema for whoever is asking.
 *
 * Resolved from the role rather than checked inside the service, so the
 * refusal happens at the edge with a message naming the field - and so the
 * allow-list is readable in one place instead of being spread through update
 * logic.
 */
export const taskUpdateSchemaFor = (role: Role) =>
    role === Role.operations ? updateOwnTaskZodSchema : updateTaskZodSchema;

export type ICreateTaskPayload = z.infer<typeof createTaskZodSchema>;
export type IUpdateTaskPayload = z.infer<typeof updateTaskZodSchema>;
