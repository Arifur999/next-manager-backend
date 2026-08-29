import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { getMailerStatus } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { SETTINGS_ID, getPlatformSettings } from "../../shared/platformSettings.js";
import { IUpdatePlatformSettingsPayload } from "./platform.validation.js";

/**
 * The platform's own configuration.
 *
 * Everything here is read by something. A settings screen whose values nothing
 * consumes is the most convincing kind of broken - it looks configured, it
 * saves, and it changes nothing:
 *
 *   product_name, support_email  -> every email this server sends
 *   default_plan_id              -> what a company that signs up itself gets
 *   default_trial_days           -> how long that trial runs
 *
 * SMTP is reported, not stored. Credentials live in the environment where they
 * can be rotated without a database write and never appear in a backup of this
 * table.
 */

const getSettings = async () => {
    const [settings, plans] = await Promise.all([
        getPlatformSettings(),
        prisma.plan.findMany({
            where: { is_active: true },
            select: { id: true, name: true, code: true, price_usd: true },
            orderBy: { sort_order: "asc" },
        }),
    ]);

    return {
        ...settings,
        // The picker's options travel with the value, so the screen never has
        // to render an id it cannot name.
        plans,
        smtp: getMailerStatus(),
    };
};

const updateSettings = async (user: IRequestUser, payload: IUpdatePlatformSettingsPayload) => {
    if (payload.default_plan_id) {
        const plan = await prisma.plan.findFirst({
            where: { id: payload.default_plan_id, is_active: true },
            select: { id: true },
        });

        // Checked rather than left to the foreign key: an inactive plan exists,
        // so the constraint would accept it and every new sign-up would land on
        // something deliberately taken off sale.
        if (!plan) {
            throw new AppError(status.BAD_REQUEST, "That plan does not exist, or is not on sale");
        }
    }

    const before = await getPlatformSettings();

    return prisma.$transaction(async (tx) => {
        const settings = await tx.platformSetting.upsert({
            where: { id: SETTINGS_ID },
            create: { id: SETTINGS_ID, ...payload, updated_by: user.userId },
            update: { ...payload, updated_by: user.userId },
        });

        // Named so the feed says what actually changed. "Updated settings"
        // tells whoever reads it later nothing at all.
        const changes = [
            before.product_name !== settings.product_name
                ? `name to "${settings.product_name}"`
                : null,
            before.support_email !== settings.support_email
                ? `support address to "${settings.support_email || "none"}"`
                : null,
            before.default_plan_id !== settings.default_plan_id
                ? settings.default_plan_id
                    ? "sign-ups now start a trial automatically"
                    : "sign-ups are left unprovisioned again"
                : null,
            before.default_trial_days !== settings.default_trial_days
                ? `trial length to ${settings.default_trial_days} days`
                : null,
        ].filter((line): line is string => line !== null);

        if (changes.length > 0) {
            await logPlatformActivity(
                tx,
                {
                    entityType: "plan",
                    entityId: null,
                    action: "updated",
                    summary: `Changed platform settings: ${changes.join("; ")}`,
                },
                user
            );
        }

        return settings;
    });
};

export const PlatformSettingsService = { getSettings, updateSettings };
