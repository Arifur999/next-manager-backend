import z from "zod";
import { Role } from "../../../generated/prisma/enums.js";
import { TaskPriority } from "../../../generated/prisma/enums.js";
import { listQuerySchema, optionalFilter, queryFlag } from "../../shared/listQuery.js";

export const createTaskZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    title: z.string("Title must be string").min(1, "Title is required"),
    description: z.string("Description must be string").optional(),
    assignee_id: z.uuid("assignee_id must be a valid id").optional().nullable(),
    // An id, not a word: the vocabulary belongs to the agency now. Absent means
    // the board's default, which is what a new task lands on.
    status_id: z.uuid("status_id must be a valid id").optional(),
    priority: z.enum(TaskPriority, "Choose a valid priority").optional(),
    due_date: z.iso.date("Due date must be YYYY-MM-DD").optional().nullable(),
});

// completed_at is deliberately not accepted on either schema - it is derived
// from status in the service, because two fields that must agree will not.
export const updateTaskZodSchema = createTaskZodSchema.partial();

/**
 * What operations may change about their own task: its status and description.
 * Due date, assignee, priority and project are the commitment they are measured
 * against. `.strict()` so an attempt to move them is refused by name rather than
 * silently dropped and reported as saved.
 */
export const updateOwnTaskZodSchema = z
    .object({
        status_id: z.uuid("status_id must be a valid id").optional(),
        description: z.string("Description must be string").optional(),
    })
    .strict();

/** The update schema for the caller's role, so a refusal names the field at the edge. */
export const taskUpdateSchemaFor = (role: Role) =>
    role === Role.operations ? updateOwnTaskZodSchema : updateTaskZodSchema;

export type ICreateTaskPayload = z.infer<typeof createTaskZodSchema>;
export type IUpdateTaskPayload = z.infer<typeof updateTaskZodSchema>;

export const taskListQueryZodSchema = listQuerySchema.extend({
    project_id: optionalFilter(z.uuid("project_id must be a valid id")),
    assignee_id: optionalFilter(z.uuid("assignee_id must be a valid id")),
    status_id: optionalFilter(z.uuid("status_id must be a valid id")),
    // A status NAME, matched case-insensitively, for links that cannot carry
    // an id that differs per agency.
    status: optionalFilter(z.string().max(60)),
    mine: queryFlag,
    // Work nobody holds yet: the triage view.
    unassigned: queryFlag,
    // A fixed "me" rather than an id: taking one would let anybody read anybody
    // else's book of clients by guessing.
    client_owner: z.unknown().optional().transform((value) => value === "me"),
    overdue: queryFlag,
    due: optionalFilter(z.enum(["today", "upcoming"], "due must be today or upcoming")),
    completed: queryFlag,
});
