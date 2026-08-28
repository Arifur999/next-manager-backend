import z from "zod";

export const assignMemberZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    user_id: z.uuid("user_id must be a valid id"),
    // Free text rather than an enum: agency roles vary per project ("Designer",
    // "Lead dev", "QA") and are not worth a migration each time one is invented.
    role_on_project: z.string("Role must be string").optional(),
});

export type IAssignMemberPayload = z.infer<typeof assignMemberZodSchema>;
