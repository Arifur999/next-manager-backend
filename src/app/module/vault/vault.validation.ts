import z from "zod";

export const createCredentialZodSchema = z.object({
    // A credential belongs to a client, a project, or neither (agency-internal).
    client_id: z.uuid("client_id must be a valid id").optional().nullable(),
    project_id: z.uuid("project_id must be a valid id").optional().nullable(),
    label: z.string("Label must be string").min(1, "Label is required"),
    url: z.string("URL must be string").optional(),
    username: z.string("Username must be string").optional(),
    password: z.string("Password must be string").min(1, "Password is required"),
    notes: z.string("Notes must be string").optional(),
});

// password is optional on update: absent means "leave it alone", so editing a
// label does not force retyping the secret.
export const updateCredentialZodSchema = createCredentialZodSchema.partial();

export type ICreateCredentialPayload = z.infer<typeof createCredentialZodSchema>;
export type IUpdateCredentialPayload = z.infer<typeof updateCredentialZodSchema>;
