import { Currency, RateSource } from "../../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

/**
 * USD -> BDT rates.
 *
 * The one thing to understand before using any of this: an API gives the
 * MID-MARKET rate, which is not the rate anyone actually receives. Payoneer,
 * PayPal and Wise each take a margin, so the BDT that lands in bKash is
 * typically 2-4 taka per dollar less than the number below.
 *
 * So the fetched rate is only ever a default and a reporting figure. The rate
 * that goes on an ExchangeTransaction is the real one the agency got, typed in
 * by whoever did the exchange - that is what makes the books reconcile.
 */

// Both are free and need no API key. The second is a fallback for when the
// first is down, which for a free service is worth planning for.
const PROVIDERS = [
    {
        name: "open.er-api.com",
        url: "https://open.er-api.com/v6/latest/USD",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extract: (body: any): number | null => {
            if (body?.result !== "success") return null;
            const rate = body?.rates?.BDT;
            return typeof rate === "number" ? rate : null;
        },
    },
    {
        name: "fawazahmed0/currency-api",
        url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extract: (body: any): number | null => {
            const rate = body?.usd?.bdt;
            return typeof rate === "number" ? rate : null;
        },
    },
] as const;

const REQUEST_TIMEOUT_MS = 10_000;

export interface FetchedRate {
    rate: number;
    provider: string;
}

/**
 * Asks each provider in turn and returns the first usable answer.
 *
 * Returns null rather than throwing when they all fail: a missing rate must
 * degrade to "use the last known one", never take the server down or fail a
 * request the user made for something else.
 */
export const fetchUsdToBdtRate = async (): Promise<FetchedRate | null> => {
    for (const provider of PROVIDERS) {
        try {
            const response = await fetch(provider.url, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            if (!response.ok) continue;

            const rate = provider.extract(await response.json());

            // A rate outside this range means the provider changed its shape or
            // returned something for the wrong pair - better to try the next one
            // than to save a figure that would quietly distort every report.
            if (rate === null || rate < 50 || rate > 400) continue;

            return { rate, provider: provider.name };
        } catch (error) {
            console.error(`[currency] ${provider.name} failed:`, (error as Error).message);
        }
    }

    return null;
};

/**
 * Fetch today's rate and store it. Safe to call repeatedly - the unique key on
 * (date, base, quote, source) means a second run the same day updates rather
 * than duplicating.
 */
export const syncTodaysRate = async (): Promise<FetchedRate | null> => {
    const fetched = await fetchUsdToBdtRate();

    if (!fetched) {
        console.error("[currency] every provider failed; keeping the last known rate");
        return null;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.currencyRate.upsert({
        where: {
            date_base_quote_source: {
                date: today,
                base: Currency.USD,
                quote: Currency.BDT,
                source: RateSource.api,
            },
        },
        create: {
            date: today,
            base: Currency.USD,
            quote: Currency.BDT,
            rate: fetched.rate,
            source: RateSource.api,
            provider: fetched.provider,
        },
        update: {
            rate: fetched.rate,
            provider: fetched.provider,
        },
    });

    return fetched;
};

/**
 * The rate to use for reporting a new payment, in priority order:
 *
 *   1. the agency's own default, if they set one in Settings
 *   2. the most recent fetched rate
 *   3. null - the caller must then require the user to type one in
 *
 * The agency's own value wins because they know what their processor actually
 * pays them, and that is a truer figure for their books than mid-market.
 */
export const getReportingRate = async (organizationId: string): Promise<number | null> => {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { default_usd_rate: true },
    });

    if (organization?.default_usd_rate) {
        return organization.default_usd_rate.toNumber();
    }

    const latest = await prisma.currencyRate.findFirst({
        where: { base: Currency.USD, quote: Currency.BDT },
        orderBy: { date: "desc" },
        select: { rate: true },
    });

    return latest?.rate.toNumber() ?? null;
};
