import z from "zod";
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

export type ICreateTaskPayload = z.infer<typeof createTaskZodSchema>;
export type IUpdateTaskPayload = z.infer<typeof updateTaskZodSchema>;
