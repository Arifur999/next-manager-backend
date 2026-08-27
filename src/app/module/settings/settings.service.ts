import status from "http-status";
import { Currency, RateSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { getReportingRate, syncTodaysRate } from "../../utils/currencyRate.js";
import { ISetDefaultRatePayload, IUpdateOrganizationPayload } from "./settings.validation.js";

const getOrganization = async (user: IRequestUser) => {
    const organization = await prisma.organization.findUnique({
        where: { id: user.organizationId },
    });

    if (!organization) {
        throw new AppError(status.NOT_FOUND, "Organization not found");
    }

    return organization;
};

const updateOrganization = async (payload: IUpdateOrganizationPayload, user: IRequestUser) => {
    const organization = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true },
    });

    if (!organization) {
        throw new AppError(status.NOT_FOUND, "Organization not found");
    }

    return prisma.organization.update({
        where: { id: user.organizationId },
        data: payload,
    });
};

/**
 * Rate history plus whatever is currently in force.
 *
 * `effective_rate` is what a new payment would actually use, resolved through
 * the same priority the payment module applies - the agency's own default
 * first, then the latest fetched figure. Showing it here means the settings
 * screen cannot disagree with what the app does.
 */
const getRateSettings = async (user: IRequestUser, limit = 30) => {
    const [organization, history, effectiveRate] = await Promise.all([
        prisma.organization.findUnique({
            where: { id: user.organizationId },
            select: { default_usd_rate: true },
        }),
        prisma.currencyRate.findMany({
            where: { base: Currency.USD, quote: Currency.BDT },
            orderBy: { date: "desc" },
            take: limit,
        }),
        getReportingRate(user.organizationId),
    ]);

    return {
        default_usd_rate: organization?.default_usd_rate?.toNumber() ?? null,
        effective_rate: effectiveRate,
        // Which of the two the app is actually using, so the UI does not have
        // to re-derive the priority rule and get it subtly wrong.
        effective_source: organization?.default_usd_rate ? RateSource.manual : RateSource.api,
        history,
    };
};

/**
 * Set or clear the agency's own reporting rate.
 *
 * Null clears it and falls back to the fetched mid-market figure. Worth
 * offering because an agency knows what its processor really pays, and that is
 * a truer number for their books than mid-market ever is.
 */
const setDefaultRate = async (payload: ISetDefaultRatePayload, user: IRequestUser) => {
    return prisma.organization.update({
        where: { id: user.organizationId },
        data: { default_usd_rate: payload.default_usd_rate },
        select: { id: true, default_usd_rate: true },
    });
};

/** Fetch today's rate now rather than waiting for the nightly cron. */
const refreshRate = async () => {
    const result = await syncTodaysRate();

    if (!result) {
        throw new AppError(
            status.SERVICE_UNAVAILABLE,
            "Could not reach any rate provider. The last known rate is still in use."
        );
    }

    return result;
};

export const SettingsService = {
    getOrganization,
    updateOrganization,
    getRateSettings,
    setDefaultRate,
    refreshRate,
};
