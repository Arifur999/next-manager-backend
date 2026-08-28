import z from "zod";

export const createMilestoneZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    title: z.string("Title must be a string").min(1, "Title is required"),
    description: z.string("Description must be a string").optional(),
    // Required, unlike Task.due_date. A milestone without a date cannot be on
    // time or late, which makes it not a milestone - it is a to-do.
    due_date: z.iso.date("Due date must be YYYY-MM-DD"),
    sort_order: z.number("Sort order must be a number").int().min(0).optional(),
});

// project_id is dropped: moving a milestone between projects would silently
// move its on-time record with it. Delete and recreate instead.
export const updateMilestoneZodSchema = createMilestoneZodSchema.omit({ project_id: true }).partial();

export type ICreateMilestonePayload = z.infer<typeof createMilestoneZodSchema>;
export type IUpdateMilestonePayload = z.infer<typeof updateMilestoneZodSchema>;

/**
 * Submission date is settable rather than always now().
 *
 * Somebody who delivered on Friday and records it on Monday should not be
 * marked late by the software, and an agency that back-dates every submission
 * has a problem no validation rule is going to fix.
 */
export const submitMilestoneZodSchema = z.object({
    submitted_at: z.iso.datetime("submitted_at must be an ISO datetime").optional(),
});

export const acceptMilestoneZodSchema = z.object({
    accepted_at: z.iso.datetime("accepted_at must be an ISO datetime").optional(),
});

export type ISubmitMilestonePayload = z.infer<typeof submitMilestoneZodSchema>;
export type IAcceptMilestonePayload = z.infer<typeof acceptMilestoneZodSchema>;
