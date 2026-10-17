import status from "http-status";
import { AnnouncementAudience } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { matchesAudience } from "./announcement.audience.js";

/**
 * Everything published since this person's account existed, so somebody joining
 * a long-standing customer does not start with a badge full of old news.
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

    const audiences = Object.values(AnnouncementAudience).filter((audience) =>
        matchesAudience(audience, subscription?.status ?? null)
    );

    return {
        deleted_at: null,
        published_at: { not: null, gte: account.created_at },
        audience: { in: audiences },
    } as const;
};

/**
 * One person's bell: platform notices and their company's notifications in one
 * list under one badge. `source` tells them apart because they clear
 * differently - an announcement is read against a shared row, a notification
 * IS the person's own row.
 */
const getMyAnnouncements = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    const [announcements, notifications] = await Promise.all([
        prisma.announcement.findMany({
            where,
            select: {
                id: true,
                title: true,
                body: true,
                published_at: true,
                reads: { where: { user_id: user.userId }, select: { read_at: true } },
            },
            orderBy: { published_at: "desc" },
            // A notice board, not an archive. Anything older than this has
            // been superseded by the product itself.
            take: 30,
        }),
        // Skipped entirely for the platform operator, who belongs to no
        // company and so can have none of these.
        user.organizationId
            ? prisma.notification.findMany({
                  where: { user_id: user.userId },
                  select: {
                      id: true,
                      title: true,
                      body: true,
                      created_at: true,
                      read_at: true,
                      entity_type: true,
                      entity_id: true,
                  },
                  orderBy: { created_at: "desc" },
                  take: 30,
              })
            : Promise.resolve([]),
    ]);

    const merged = [
        ...announcements.map(({ reads, published_at, ...row }) => ({
            ...row,
            source: "platform" as const,
            published_at,
            read_at: reads[0]?.read_at ?? null,
            entity_type: "",
            entity_id: null as string | null,
        })),
        ...notifications.map(({ created_at, ...row }) => ({
            ...row,
            source: "company" as const,
            published_at: created_at,
        })),
    ];

    // Sorted across both, so the panel reads as one timeline rather than two
    // lists stapled together.
    return merged
        .sort((a, b) => (b.published_at?.getTime() ?? 0) - (a.published_at?.getTime() ?? 0))
        .slice(0, 30);
};

const getUnreadCount = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    // One number over both sources. A badge that counts half of what the
    // panel shows is worse than no badge.
    const [notices, mine] = await Promise.all([
        prisma.announcement.count({
            where: { ...where, reads: { none: { user_id: user.userId } } },
        }),
        user.organizationId
            ? prisma.notification.count({ where: { user_id: user.userId, read_at: null } })
            : Promise.resolve(0),
    ]);

    return { unread: notices + mine };
};

/**
 * Mark one read; the id may be either kind. The caller's own notification is
 * looked for first and both lookups are scoped to the caller, so nobody can
 * clear somebody else's bell. Upserted, so a second click is not an error.
 */
const markRead = async (user: IRequestUser, id: string) => {
    if (user.organizationId) {
        const mine = await prisma.notification.findFirst({
            where: { id, user_id: user.userId },
            select: { id: true, read_at: true },
        });

        if (mine) {
            if (!mine.read_at) {
                await prisma.notification.update({
                    where: { id },
                    data: { read_at: new Date() },
                });
            }

            return { id };
        }
    }

    const where = await myAnnouncementFilter(user);
    const announcement = await prisma.announcement.findFirst({
        where: { ...where, id },
        select: { id: true },
    });

    if (!announcement) {
        throw new AppError(status.NOT_FOUND, "That notification does not exist");
    }

    await prisma.announcementRead.upsert({
        where: { announcement_id_user_id: { announcement_id: id, user_id: user.userId } },
        create: { announcement_id: id, user_id: user.userId },
        update: {},
    });

    return { id };
};

/** Clears both sources, because the badge counts both. */
const markAllRead = async (user: IRequestUser) => {
    const where = await myAnnouncementFilter(user);

    const [unread, mine] = await Promise.all([
        prisma.announcement.findMany({
            where: { ...where, reads: { none: { user_id: user.userId } } },
            select: { id: true },
        }),
        user.organizationId
            ? prisma.notification.updateMany({
                  where: { user_id: user.userId, read_at: null },
                  data: { read_at: new Date() },
              })
            : Promise.resolve({ count: 0 }),
    ]);

    if (unread.length > 0) {
        await prisma.announcementRead.createMany({
            data: unread.map((row) => ({ announcement_id: row.id, user_id: user.userId })),
            // Two tabs, one button each. The second one is not an error.
            skipDuplicates: true,
        });
    }

    return { marked: unread.length + mine.count };
};

export const NotificationBellService = {
    getMyAnnouncements,
    getUnreadCount,
    markRead,
    markAllRead,
};
