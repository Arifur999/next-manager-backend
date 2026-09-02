import { z } from "zod";

export const createConversationZodSchema = z
    .object({
        type: z.enum(["direct", "group", "project"], "Type must be direct, group or project"),
        // Groups and project threads carry a name. A direct conversation is
        // named after whoever you are talking to, which differs for each of the
        // two people in it, so it is never stored.
        name: z.string("Name must be a string").max(120).optional(),
        project_id: z.uuid("project_id must be a valid id").optional(),
        member_ids: z
            .array(z.uuid("Each member id must be valid"))
            .min(1, "A conversation needs somebody in it")
            .max(100, "That is more people than one conversation holds"),
    })
    .refine((value) => value.type !== "direct" || value.member_ids.length === 1, {
        message: "A direct conversation is between you and exactly one other person",
        path: ["member_ids"],
    })
    .refine((value) => value.type !== "group" || Boolean(value.name?.trim()), {
        message: "Give the group a name",
        path: ["name"],
    })
    .refine((value) => value.type !== "project" || Boolean(value.project_id), {
        message: "Say which project the thread belongs to",
        path: ["project_id"],
    });

export const sendMessageZodSchema = z.object({
    body: z
        .string("A message must be text")
        .trim()
        .min(1, "An empty message is not a message")
        .max(4000, "That message is too long to send"),
});

export const addMembersZodSchema = z.object({
    member_ids: z
        .array(z.uuid("Each member id must be valid"))
        .min(1, "Say who to add")
        .max(100, "That is more people than one conversation holds"),
});

export type ICreateConversationPayload = z.infer<typeof createConversationZodSchema>;
export type ISendMessagePayload = z.infer<typeof sendMessageZodSchema>;
export type IAddMembersPayload = z.infer<typeof addMembersZodSchema>;
