import { Response } from "express";

interface IResponseData<T> {
    httpStatus: number;
    success: boolean;
    data?: T;
    meta?: {
        page: number;
        limit: number;
        total: number;
        totalPage: number;
        /**
         * Sums that belong to the whole filtered list rather than the page of
         * it that came back - the transactions ledger uses this.
         *
         * Per currency, never across it: adding dollars to taka produces a
         * number that is true of nothing. Named explicitly rather than letting
         * meta take any key, so a typo here is a compile error and not a field
         * the client silently never receives.
         */
        totals?: Array<{ currency: string; amount: number }>;
        /**
         * The number the security screen exists for, counted across the
         * whole window rather than the page - narrowing the list must not
         * hide the thing somebody opened the page to notice.
         */
        failed_last_24h?: number;
        /** How long login history is kept, so the screen can say it. */
        retention_days?: number;
        /**
         * How much of the business is spoken for, and how much is not.
         *
         * A property of the whole shareholder list rather than of any row,
         * and the question the page is opened with - "who owns the rest" is
         * not something a reader should have to work out by subtracting.
         */
        allocated_pct?: number;
        unallocated_pct?: number;
    };
    message: string;
}

// Prisma hands back Decimal objects and Date instances. Neither is something a
// browser should have to understand, and both have a single correct shape for
// this app, so the conversion happens once here rather than in every service.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDecimalLike = (value: any): boolean => {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.toNumber === "function" &&
        typeof value.toFixed === "function"
    );
};

const serializeDate = (value: Date): string => {
    const isUtcMidnight =
        value.getUTCHours() === 0 &&
        value.getUTCMinutes() === 0 &&
        value.getUTCSeconds() === 0 &&
        value.getUTCMilliseconds() === 0;

    // A @db.Date column is a calendar day, not an instant. Sending it as a full
    // ISO timestamp makes the browser shift it by the local UTC offset, which
    // moves a date backwards by a day for anyone west of Greenwich.
    if (isUtcMidnight) {
        return value.toISOString().slice(0, 10);
    }
    return value.toISOString();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const serializeData = (value: any): any => {
    if (value === null || value === undefined) return value;

    if (value instanceof Date) {
        return serializeDate(value);
    }

    if (isDecimalLike(value)) {
        return value.toNumber();
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeData(item));
    }

    if (typeof value === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            result[key] = serializeData(value[key]);
        }
        return result;
    }

    return value;
};

export const sendResponse = <T>(res: Response, responseData: IResponseData<T>) => {
    const { httpStatus, success, data, message } = responseData;
    res.status(httpStatus).json({
        success,
        data: serializeData(data),
        meta: responseData.meta,
        message,
    });
};
