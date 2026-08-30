import { NotificationEvent, Role } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { EVENT_CATALOGUE } from "../../shared/notify.js";
import { ISetNotificationRulePayload } from "./notificationRule.validation.js";

/**
 * Which events are worth telling people about, and who hears them.
 *
 * Rows are created on demand, never seeded. An agency that has never opened
 * this screen has no rows at all and still gets the notifications that matter,
 * because an absent row means the built-in default rather than "off".
 *
 * That is also why the list endpoint returns the whole catalogue with defaults
 * filled in rather than whatever rows happen to exist: a settings screen that
 * shows five switches on one agency and none on another, for the same product,
 * is a screen nobody can be told how to use.
 */

const getRules = async (user: IRequestUser) => {
    const stored = await prisma.notificationRule.findMany({
        where: { organization_id: user.organizationId },
    });

    const byEvent = new Map(stored.map((row) => [row.event, row]));

    return (Object.keys(EVENT_CATALOGUE) as NotificationEvent[]).map((event) => {
        const rule = byEvent.get(event);
        const catalogue = EVENT_CATALOGUE[event];

        return {
            event,
            kind: catalogue.kind,
            label: catalogue.label,
            description: catalogue.description,
            in_app: rule?.in_app ?? true,
            email: rule?.email ?? false,
            // The effective audience, not the stored one. An empty stored list
            // means "use the default", and showing an empty picker for it would
            // read as "nobody is told", which is the opposite of the truth.
            roles: rule && rule.roles.length > 0 ? rule.roles : catalogue.defaultRoles,
            /** Whether anybody has ever touched this one. */
            customised: Boolean(rule),
        };
    });
};

const setRule = async (
    event: NotificationEvent,
    payload: ISetNotificationRulePayload,
    user: IRequestUser
) => {
    const catalogue = EVENT_CATALOGUE[event];

    // A directed event goes to the person it concerns - the assignee of a task,
    // whatever their role. Storing a role list against it would be a control
    // that silently does nothing, so it is refused rather than accepted and
    // ignored.
    const roles: Role[] = catalogue.kind === "directed" ? [] : (payload.roles ?? []);

    return prisma.$transaction(async (tx) => {
        const rule = await tx.notificationRule.upsert({
            where: { organization_id_event: { organization_id: user.organizationId, event } },
            create: {
                organization_id: user.organizationId,
                event,
                in_app: payload.in_app ?? true,
                email: payload.email ?? false,
                roles,
            },
            update: {
                ...(payload.in_app !== undefined ? { in_app: payload.in_app } : {}),
                ...(payload.email !== undefined ? { email: payload.email } : {}),
                ...(catalogue.kind === "broadcast" && payload.roles !== undefined ? { roles } : {}),
            },
        });

        await logActivity(
            tx,
            {
                entityType: "notification_rule",
                entityId: rule.id,
                action: "updated",
                summary: rule.in_app
                    ? `Notifications on for "${catalogue.label}"`
                    : `Notifications off for "${catalogue.label}"`,
            },
            user
        );

        return {
            event,
            kind: catalogue.kind,
            label: catalogue.label,
            description: catalogue.description,
            in_app: rule.in_app,
            email: rule.email,
            roles: rule.roles.length > 0 ? rule.roles : catalogue.defaultRoles,
            customised: true,
        };
    });
};

export const NotificationRuleService = { getRules, setRule };
