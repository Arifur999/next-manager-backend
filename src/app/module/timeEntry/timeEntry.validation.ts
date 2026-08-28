import z from "zod";

export const createTimeEntryZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    // Optional: a day can be logged against a project without naming a task.
    task_id: z.uuid("task_id must be a valid id").optional().nullable(),
    date: z.iso.date("Date must be YYYY-MM-DD"),
    // Capped at 24 in the service, where the message can explain itself. Here
    // it only has to be a positive number - a zero-hour entry is a mistake, not
    // a record of anything.
    hours: z.number("Hours must be a number").positive("Hours must be greater than zero"),
    // Defaulting to true would quietly inflate utilization every time somebody
    // forgot to untick it, so the client has to say. The frontend defaults the
    // control, which is a different thing from the API assuming.
    is_billable: z.boolean("is_billable must be a boolean"),
    notes: z.string("Notes must be string").optional(),
});

export const updateTimeEntryZodSchema = createTimeEntryZodSchema.partial();

export type ICreateTimeEntryPayload = z.infer<typeof createTimeEntryZodSchema>;
export type IUpdateTimeEntryPayload = z.infer<typeof updateTimeEntryZodSchema>;

export const setCapacityZodSchema = z.object({
    // A working week, not a life. The ceiling is a guard against a typo that
    // would make everyone look permanently under-utilised.
    weekly_hours: z
        .number("Weekly hours must be a number")
        .positive("Weekly hours must be greater than zero")
        .max(80, "That is more than a working week - check the figure"),
});

export type ISetCapacityPayload = z.infer<typeof setCapacityZodSchema>;
