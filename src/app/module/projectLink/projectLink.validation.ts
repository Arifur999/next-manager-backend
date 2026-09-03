import z from "zod";

export const createProjectLinkZodSchema = z.object({
    project_id: z.uuid("project_id must be a valid id"),
    label: z.string("Label must be a string").min(1, "Give it a name"),
    // Validated as a URL and required to be http(s). Nothing here ever fetches
    // it, but a `javascript:` or `data:` value stored now is one somebody's
    // browser follows later from a link on the project page.
    url: z
        .string("URL must be a string")
        .url("Enter a full URL, including https://")
        .refine(
            (value) => /^https?:\/\//i.test(value),
            "Only http and https links can be stored"
        ),
    notes: z.string("Notes must be a string").optional(),
});

export const updateProjectLinkZodSchema = createProjectLinkZodSchema
    .omit({ project_id: true })
    .partial();

export type ICreateProjectLinkPayload = z.infer<typeof createProjectLinkZodSchema>;
export type IUpdateProjectLinkPayload = z.infer<typeof updateProjectLinkZodSchema>;
