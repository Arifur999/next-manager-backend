import status from "http-status";
import {
    AnnouncementAudience,
    Role,
    SubscriptionStatus,
    UserStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { announcementMail, sendMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { getBrand } from "../../shared/platformSettings.js";
import {
    ICreateAnnouncementPayload,
    IUpdateAnnouncementPayload,
} from "./platform.validation.js";

/**
 * Telling customers things.
 *
 * Two decisions shape everything below.
 *
 * **Audience is resolved when the notice is read, not when it is published.**
 * There is no recipient table. A company that starts paying tomorrow sees the
 * notice aimed at paying customers without anybody re-sending it, and a company
 * that leaves stops seeing it. The alternative - fanning out a row per user at
 * publish - freezes the audience at a moment that is already stale by the time
 * anyone reads it, and grows a table nobody prunes.
 *
 * **The bell reaches everybody in a company; the email reaches its admin.**
 * "Maintenance on Sunday" is for whoever is working on Sunday, which is not
 * only the person who pays. Email is the opposite case: it leaves the product,
 * it cannot be unsent, and a price change mailed to every operations person at
 * every customer is a blast radius nobody asked for.
 */

const ANNOUNCEMENT_FIELDS = {
    id: true,
    title: true,
    body: true,
    audience: true,
    send_email: true,
    published_at: true,
    emailed_count: true,
    created_at: true,
    updated_at: true,
} as const;

/**
 * Which subscription states each audience covers.
 *
 * `active` includes `past_due` for the same reason the MRR figure does: a
 * company inside its grace window is still a paying customer, and it is the one
 * most worth reaching before it stops being one.
 */
const AUDIENCE_STATUSES: Record<AnnouncementAudience, SubscriptionStatus[] | null> = {
    all: null,
    trialing: [SubscriptionStatus.trialing],
    active: [SubscriptionStatus.active, SubscriptionStatus.past_due],
};

/** Does this company fall inside that audience right now? */
const matchesAudience = (
    audience: AnnouncementAudience,
    subscriptionStatus: SubscriptionStatus | null
) => {
    const wanted = AUDIENCE_STATUSES[audience];
    if (wanted === null) return true;
    if (subscriptionStatus === null) return false;

    return wanted.includes(subscriptionStatus);
};

// ---------------------------------------------------------------- console

const getAnnouncements = async () =>
    prisma.announcement.findMany({
        where: { deleted_at: null },
        select: { ...ANNOUNCEMENT_FIELDS, _count: { select: { reads: true } } },
        // Drafts first - they are the ones still needing a decision - then
        // newest published.
        orderBy: [{ published_at: { sort: "desc", nulls: "first" } }, { created_at: "desc" }],
    });

const createAnnouncement = async (user: IRequestUser, payload: ICreateAnnouncementPayload) =>
    prisma.$transaction(async (tx) => {
        const announcement = await tx.announcement.create({
            data: { ...payload, created_by: user.userId },
            select: ANNOUNCEMENT_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "campaign",
                entityId: announcement.id,
                action: "created",
                summary: `Drafted announcement "${announcement.title}"`,
            },
            user
        );

        return announcement;
    });

/**
 * Editing.
 *
 * Only while it is a draft. Once a notice is out, people have read it and some
 * have been emailed a copy; quietly rewriting the text underneath them would
 * leave two versions of what the platform said and no way to tell which one
 * somebody acted on. Publish a correction instead.
 */
const updateAnnouncement = async (
    user: IRequestUser,
    id: string,
    payload: IUpdateAnnouncementPayload
) => {
    const existing = await prisma.announcement.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, title: true, published_at: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "That announcement does not exist");
    }

    if (existing.published_at) {
        throw new AppError(
            status.BAD_REQUEST,
            "This one has already gone out, so it cannot be edited. Publish a correction instead."
        );
    }

    return prisma.$transaction(async (tx) => {
        const announcement = await tx.announcement.update({
            where: { id },
            data: payload,
            select: ANNOUNCEMENT_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "campaign",
                entityId: id,
                action: "updated",
                summary: `Edited draft announcement "${announcement.title}"`,
            },
            user
        );

        return announcement;
    });
};

/**
 * Sending it.
 *
 * The write and the email are deliberately not in one transaction. Mail is a
 * network call to somebody else's server and can hang for as long as it likes;
 * holding a database transaction open across it is how a connection pool dies.
 * So: publish first, then mail, then record how many addresses it reached.
 *
 * That ordering also picks the right failure. If the mail step falls over, the
 * notice is still published and `emailed_count` stays null - "we do not know
 * how many got the email", which is true. The other order would risk a mail
 * going out about a notice that no longer exists.
 */
const publishAnnouncement = async (user: IRequestUser, id: string) => {
    const existing = await prisma.announcement.findFirst({
        where: { id, deleted_at: null },
        select: {
            id: true,
            title: true,
            body: true,
            audience: true,
            send_email: true,
            published_at: true,
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "That announcement does not exist");
    }

    if (existing.published_at) {
        throw new AppError(status.BAD_REQUEST, "That announcement has already been published");
    }

    const reach =
        existing.audience === AnnouncementAudience.all
            ? "every customer"
            : `${existing.audience} customers`;

    const published = await prisma.$transaction(async (tx) => {
        const row = await tx.announcement.update({
            where: { id },
            data: { published_at: new Date() },
            select: ANNOUNCEMENT_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "campaign",
                entityId: id,
                action: "sent",
                summary: `Published announcement "${row.title}" to ${reach}`,
            },
            user
        );

        return row;
    });

    if (!existing.send_email) {
        return { ...published, email: null };
    }

    const statuses = AUDIENCE_STATUSES[existing.audience];
    const recipients = await prisma.user.findMany({
        where: {
            role: Role.admin,
            status: UserStatus.active,
            deleted_at: null,
            // Organization carries no soft-delete column; the company either
            // exists or it does not. The user-level one above is what filters
            // people who have left.
            ...(statuses ? { organization: { subscription: { status: { in: statuses } } } } : {}),
        },
        select: { email: true, full_name: true },
    });

    const brand = await getBrand();
    let delivered = 0;
    const failures: string[] = [];

    // One message each rather than one with everybody in bcc: a single refused
    // recipient must not take down the whole send, and the count has to be real.
    for (const recipient of recipients) {
        const result = await sendMail({
            to: recipient.email,
            ...announcementMail(existing.title, existing.body, recipient.full_name, brand),
        });

        if (result.delivered) delivered += 1;
        else failures.push(result.reason);
    }

    await prisma.announcement.update({ where: { id }, data: { emailed_count: delivered } });

    return {
        ...published,
        emailed_count: delivered,
        email: {
            attempted: recipients.length,
            delivered,
            // One line, not one per failed address - they share a cause almost
            // every time, and the cause is what tells you what to fix.
            reason: failures.length > 0 ? failures[0] : null,
        },
    };
};

const deleteAnnouncement = async (user: IRequestUser, id: string) => {
    const existing = await prisma.announcement.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, title: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "That announcement does not exist");
    }

    return prisma.$transaction(async (tx) => {
        await tx.announcement.update({ where: { id }, data: { deleted_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "campaign",
                entityId: id,
                action: "deleted",
                summary: `Removed announcement "${existing.title}"`,
            },
            user
        );

        return { id };
    });
};

// ---------------------------------------------------------------- customer

/**
 * Everything published since this person's account existed.
 *
 * The cutoff is deliberate. Without it somebody joining a two-year-old customer
 * lands on a badge showing every notice the platform has ever sent, none of
 * which is news to them, and the first thing they learn about the bell is that
 * it can be ignored.
 */
const myAnnouncementFilter = async (user: IRequestUser) => {
    const [account, subscription] = await Promise.all([
        prisma.user.findUnique({ where: { id: user.userId }, select: { created_at: true } }),
        user.organizationId
            ? prisma.subscription.findUnique({
                  where: { organization_id: user.organizationId },
                  select: { status: true },
              })
            : Promise.resolve(null),
    ]);

    if (!account) {
        throw new AppError(status.NOT_FOUND, "Account not found");
    }

    const audiences = (Object.keys(AUDIENCE_STATUSES) as AnnouncementAudience[]).filter(
        (audience) => matchesAudience(audience, subscription?.status ?? null)
    );

    return {
        deleted_at: null,
        published_at: { not: null, gte: account.created_at },
        audience: { in: audiences },
    } as const;
};

const getMyAnnouncements = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    const announcements = await prisma.announcement.findMany({
        where,
        select: {
            id: true,
            title: true,
            body: true,
            published_at: true,
            reads: { where: { user_id: user.userId }, select: { read_at: true } },
        },
        orderBy: { published_at: "desc" },
        // A notice board, not an archive. Anything older than this has been
        // superseded by the product itself.
        take: 30,
    });

    return announcements.map(({ reads, ...announcement }) => ({
        ...announcement,
        read_at: reads[0]?.read_at ?? null,
    }));
};

const getUnreadCount = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    const unread = await prisma.announcement.count({
        where: { ...where, reads: { none: { user_id: user.userId } } },
    });

    return { unread };
};

/**
 * Marking one read.
 *
 * Upsert, because a second click is not a second reading and a unique
 * constraint violation is not something the bell should ever show anybody.
 */
const markRead = async (user: IRequestUser, id: string) => {
    const where = await myAnnouncementFilter(user);
    const announcement = await prisma.announcement.findFirst({
        where: { ...where, id },
        select: { id: true },
    });

    if (!announcement) {
        throw new AppError(status.NOT_FOUND, "That announcement does not exist");
    }

    await prisma.announcementRead.upsert({
        where: { announcement_id_user_id: { announcement_id: id, user_id: user.userId } },
        create: { announcement_id: id, user_id: user.userId },
        update: {},
    });

    return { id };
};

const markAllRead = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    const unread = await prisma.announcement.findMany({
        where: { ...where, reads: { none: { user_id: user.userId } } },
        select: { id: true },
    });

    if (unread.length === 0) {
        return { marked: 0 };
    }

    await prisma.announcementRead.createMany({
        data: unread.map((row) => ({ announcement_id: row.id, user_id: user.userId })),
        // Two tabs, one button each. The second one is not an error.
        skipDuplicates: true,
    });

    return { marked: unread.length };
};

export const AnnouncementService = {
    getAnnouncements,
    createAnnouncement,
    updateAnnouncement,
    publishAnnouncement,
    deleteAnnouncement,
    getMyAnnouncements,
    getUnreadCount,
    markRead,
    markAllRead,
};
