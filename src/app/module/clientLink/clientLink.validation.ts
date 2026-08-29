import z from "zod";

export const createClientLinkZodSchema = z.object({
    client_id: z.uuid("client_id must be a valid id"),
    label: z.string("Label must be a string").min(1, "Give it a name"),
    // Validated as a URL and required to be http(s). Nothing here ever fetches
    // it, but a `javascript:` or `data:` value stored now is one somebody's
    // browser follows later from a link on the client page.
    url: z
        .string("URL must be a string")
        .url("Enter a full URL, including https://")
        .refine(
            (value) => /^https?:\/\//i.test(value),
            "Only http and https links can be stored"
        ),
    notes: z.string("Notes must be a string").optional(),
});

export const updateClientLinkZodSchema = createClientLinkZodSchema
    .omit({ client_id: true })
    .partial();

export type ICreateClientLinkPayload = z.infer<typeof createClientLinkZodSchema>;
export type IUpdateClientLinkPayload = z.infer<typeof updateClientLinkZodSchema>;
