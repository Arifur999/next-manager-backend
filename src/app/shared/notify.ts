import { Prisma } from "../../generated/prisma/client.js";
import { NotificationEvent, Role, UserStatus } from "../../generated/prisma/enums.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";
import { logger } from "../lib/logger.js";
import { notificationMail, sendMail } from "../lib/mailer.js";
import { webAppUrl } from "./oneTimeLink.js";
import { getBrand } from "./platformSettings.js";

/**
 * Telling one person something happened. "Who should hear about this" is
 * decided here once, so no module forgets to leave the actor out.
 */

type Tx = Prisma.TransactionClient;

/**
 * How each event finds its audience: `directed` events go to one named person
 * (a task's assignee), `broadcast` events to the roles the agency chose,
 * defaulting to those below. Kept in code, because it is a property of the
 * event; a role picker on a directed event would do nothing.
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

type Rule = { in_app: boolean; email: boolean; roles: Role[] };

/** Somebody an event can reach. */
export type NotifyPerson = { id: string; email: string; full_name: string; status: UserStatus };

const PERSON = { id: true, email: true, full_name: true, status: true } as const;

/**
 * The rule for one event, or the built-in default.
 *
 * Rules are created on demand, so an agency that never opens the settings
 * screen still gets the notifications that matter. An absent row is not "off".
 */
const ruleFor = async (tx: Tx, organizationId: string, event: NotificationEvent): Promise<Rule> => {
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

/** Everybody the event is addressed to, before the actor is taken out. */
const audienceOf = async (tx: Tx, organizationId: string, input: NotifyInput, rule: Rule): Promise<NotifyPerson[]> => {
    if (EVENT_CATALOGUE[input.event].kind === "directed") {
        if (!input.userId) return [];

        return tx.user.findMany({
            where: { id: input.userId, organization_id: organizationId, deleted_at: null },
            select: PERSON,
        });
    }

    return tx.user.findMany({
        where: {
            organization_id: organizationId,
            deleted_at: null,
            status: UserStatus.active,
            role: { in: rule.roles },
        },
        select: PERSON,
    });
};

/**
 * Who hears about it, and how. The actor never hears about their own action:
 * that noise is what teaches people to ignore the bell. Mail goes only where
 * the agency turned it on, and only to people who can still sign in.
 */
export const planDelivery = (
    rule: Pick<Rule, "in_app" | "email">,
    audience: NotifyPerson[],
    actorId: string
): { inApp: NotifyPerson[]; mail: NotifyPerson[] } => {
    const reached = audience.filter((person) => person.id !== actorId);

    return {
        inApp: rule.in_app ? reached : [],
        mail: rule.email ? reached.filter((person) => person.status === UserStatus.active) : [],
    };
};

/** Mail notify() composed inside a transaction, for sendNotificationMail once it commits. */
export interface PendingNotificationMail {
    recipients: Array<{ email: string; full_name: string }>;
    title: string;
    body: string;
    eventLabel: string;
    agencyName: string;
}

/**
 * Write the notification rows for one thing that happened, INSIDE the
 * transaction that did it, like logActivity. Returns the mail to send once the
 * transaction commits (or null): mail is a network call, and one sent for work
 * that then rolled back cannot be unsent.
 */
export const notify = async (
    tx: Tx,
    actor: IRequestUser,
    input: NotifyInput
): Promise<PendingNotificationMail | null> => {
    const rule = await ruleFor(tx, actor.organizationId, input.event);

    if (!rule.in_app && !rule.email) return null;

    const audience = await audienceOf(tx, actor.organizationId, input, rule);
    const plan = planDelivery(rule, audience, actor.userId);

    if (plan.inApp.length > 0) {
        await tx.notification.createMany({
            data: plan.inApp.map((person) => ({
                organization_id: actor.organizationId,
                user_id: person.id,
                event: input.event,
                title: input.title,
                body: input.body ?? "",
                entity_type: input.entityType ?? "",
                entity_id: input.entityId ?? null,
            })),
        });
    }

    if (plan.mail.length === 0) return null;

    const organization = await tx.organization.findUnique({
        where: { id: actor.organizationId },
        select: { name: true },
    });

    return {
        recipients: plan.mail.map((person) => ({ email: person.email, full_name: person.full_name })),
        title: input.title,
        body: input.body ?? "",
        eventLabel: EVENT_CATALOGUE[input.event].label,
        agencyName: organization?.name ?? "",
    };
};

/**
 * Send what notify() composed, after its transaction committed. Never throws:
 * the work it reports on is already saved, and a mail server being down must
 * not turn that into an error. Failures are logged without addresses.
 */
export const sendNotificationMail = async (pending: PendingNotificationMail | null): Promise<void> => {
    if (!pending) return;

    try {
        const brand = await getBrand();
        const link = webAppUrl("/login");
        const results = await Promise.all(
            pending.recipients.map((recipient) =>
                sendMail({
                    to: recipient.email,
                    ...notificationMail({ ...pending, recipientName: recipient.full_name, link }, brand),
                })
            )
        );

        const undelivered = results.filter((result) => !result.delivered).length;
        if (undelivered > 0) {
            logger.warn("Notification mail was not delivered", {
                event: pending.eventLabel,
                undelivered,
                total: results.length,
            });
        }
    } catch (error) {
        logger.error("Notification mail failed", { error });
    }
};
