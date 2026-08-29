import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

/**
 * How this installation describes itself.
 *
 * Read straight from the database every time rather than cached. It is a
 * single-row primary-key lookup - cheaper than the mail send or the sign-up
 * transaction it sits inside - and a cache here would buy nothing while
 * introducing a window where somebody has changed a setting, been told it
 * saved, and is watching the old value still being used.
 *
 * The row is created by the migration, so there is no "nobody has saved yet"
 * branch anywhere. The fallback below exists only for the case where somebody
 * has deleted it by hand, and matches the column defaults.
 */

export const SETTINGS_ID = "singleton";

export interface PlatformBrand {
    productName: string;
    /** Empty means say nothing, rather than invent an address nobody reads. */
    supportEmail: string;
}

export const getPlatformSettings = async (tx: Prisma.TransactionClient | typeof prisma = prisma) =>
    (await tx.platformSetting.findUnique({ where: { id: SETTINGS_ID } })) ?? {
        id: SETTINGS_ID,
        product_name: "AGENCIO",
        support_email: "",
        default_plan_id: null,
        default_trial_days: 14,
        updated_at: new Date(),
        updated_by: null,
    };

/** Just the parts the mail templates need. */
export const getBrand = async (): Promise<PlatformBrand> => {
    const settings = await getPlatformSettings();

    return { productName: settings.product_name, supportEmail: settings.support_email };
};
