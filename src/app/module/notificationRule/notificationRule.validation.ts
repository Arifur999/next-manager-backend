import z from "zod";
import { NotificationEvent, Role } from "../../../generated/prisma/enums.js";

// super_admin is a platform role and belongs to no company, so it can never be
// an audience for a company's own notifications.
const audienceRoles = [Role.admin, Role.sales, Role.project_manager, Role.operations] as const;

export const setNotificationRuleZodSchema = z.object({
    in_app: z.boolean("in_app must be true or false").optional(),
    email: z.boolean("email must be true or false").optional(),
    // Absent means "leave it alone"; an empty array means "back to the default
    // audience", which is a real choice and not the same as nobody.
    roles: z.array(z.enum(audienceRoles, "Unknown role")).optional(),
});

export const notificationEventParam = z.enum(NotificationEvent, "Unknown event");

export type ISetNotificationRulePayload = z.infer<typeof setNotificationRuleZodSchema>;
