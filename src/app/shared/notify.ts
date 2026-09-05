import { Prisma } from "../../generated/prisma/client.js";
import { NotificationEvent, Role, UserStatus } from "../../generated/prisma/enums.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/**
 * Telling one person something happened.
 *
 * The whole point of putting this in one place is that "who should hear about
 * this" is decided once. Scattered through the modules it becomes seven
 * slightly different answers, and the one that forgets to exclude the actor
 * sends somebody a notification about their own click.
 */

type Tx = Prisma.TransactionClient;

/**
 * How each event finds its audience.
 *
 * `directed` events go to one named person — a task assignment goes to whoever
 * it was handed to, and no arrangement of roles expresses that. `broadcast`
 * events go to whichever roles the agency chose, defaulting to the roles below.
 *
 * The distinction is in code rather than in the settings row because it is a
 * property of the event, not a preference. Offering a role picker for a
 * directed event would be a control that silently does nothing.
 */
export const EVENT_CATALOGUE: Record<
    NotificationEvent,
    {
        kind: "directed" | "broadcast";
        label: string;
        description: string;
        /** Who hears it when the agency has not said otherwise. */
        defaultRoles: Role[];
    }
> = {
    task_assigned: {
        kind: "directed",
        label: "A task is assigned to you",
        description: "Goes to the person the work was handed to, whatever their role.",
        defaultRoles: [],
    },
    time_awaiting_approval: {
        kind: "broadcast",
        label: "Hours are waiting to be approved",
        description: "Somebody logged time that needs signing off.",
        defaultRoles: [Role.admin, Role.project_manager],
    },
    payment_recorded: {
        kind: "broadcast",
        label: "A client payment lands",
        description: "Money arrived and was recorded against a client.",
        defaultRoles: [Role.admin],
    },
    member_awaiting_approval: {
        kind: "broadcast",
        label: "Somebody is waiting to join",
        description:
            "A person accepted an invite and cannot sign in until they are approved.",
        defaultRoles: [Role.admin],
    },
    leave_requested: {
        kind: "broadcast",
        label: "Somebody asks for leave",
        description:
            "A request is waiting for a decision. Without this it sits in a queue nobody has a reason to open.",
        defaultRoles: [Role.admin, Role.project_manager],
    },
    leave_decided: {
        kind: "directed",
        label: "Your leave is decided",
        description:
            "Goes to the person who asked, whatever their role - they are the one waiting on the answer.",
        defaultRoles: [],
    },
    invoice_overdue: {
        kind: "broadcast",
        label: "An invoice goes overdue",
        description: "Checked once a night. Sent once per invoice, on the day it turns.",
        defaultRoles: [Role.admin, Role.sales],
    },
};

interface NotifyInput {
    event: NotificationEvent;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string | null;
    /** Required for a directed event, ignored for a broadcast one. */
    userId?: string;
}

/**
 * The rule for one event, or the built-in default.
 *
 * Rules are created on demand, so an agency that never opens the settings
 * screen still gets the notifications that matter. An absent row is not "off".
 */
const ruleFor = async (tx: Tx, organizationId: string, event: NotificationEvent) => {
    const stored = await tx.notificationRule.findUnique({
        where: { organization_id_event: { organization_id: organizationId, event } },
    });

    const fallback = EVENT_CATALOGUE[event];

    return {
        in_app: stored?.in_app ?? true,
        email: stored?.email ?? false,
        roles: stored && stored.roles.length > 0 ? stored.roles : fallback.defaultRoles,
    };
};

/**
 * Write the notification rows for one thing that happened.
 *
 * Called INSIDE the transaction that did the thing, like logActivity: a
 * notification about a payment that then failed to save is worse than none.
 *
 * The actor never hears about their own action. Telling somebody what they just
 * did is noise, and noise is what teaches people to ignore the bell — which
 * then hides the one notification that mattered.
 */
export const notify = async (tx: Tx, actor: IRequestUser, input: NotifyInput) => {
    const rule = await ruleFor(tx, actor.organizationId, input.event);

    if (!rule.in_app) return [];

    const catalogue = EVENT_CATALOGUE[input.event];

    const recipients =
        catalogue.kind === "directed"
            ? input.userId
                ? [input.userId]
                : []
            : (
                  await tx.user.findMany({
                      where: {
                          organization_id: actor.organizationId,
                          deleted_at: null,
                          status: UserStatus.active,
                          role: { in: rule.roles },
                      },
                      select: { id: true },
                  })
              ).map((row) => row.id);

    const audience = recipients.filter((id) => id !== actor.userId);

    if (audience.length === 0) return [];

    await tx.notification.createMany({
        data: audience.map((userId) => ({
            organization_id: actor.organizationId,
            user_id: userId,
            event: input.event,
            title: input.title,
            body: input.body ?? "",
            entity_type: input.entityType ?? "",
            entity_id: input.entityId ?? null,
        })),
    });

    return audience;
};
