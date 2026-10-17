import z from "zod";
import { endOfDay, toDateOnly } from "./dates.js";

// Shared pieces for list endpoints that page, search and date-filter. A search
// is a literal case-insensitive "contains" ("50%" means those three characters,
// so LIKE wildcards are escaped), and paging is opt-in: no limit returns all.

export interface ListOptions {
    page?: number;
    limit?: number;
    search?: string;
    // Inclusive date bounds, as YYYY-MM-DD. The browser asks for the range it is
    // about to display; without them a page showing one month still has to
    // download every row the agency has ever had.
    from?: string;
    to?: string;
}

// LIKE treats % and _ as wildcards and \ as the escape character. A term the
// user typed has to be matched literally.
export const escapeLikeTerm = (term: string): string =>
    term.replace(/[\\%_]/g, (character) => `\\${character}`);

export const MAX_PAGE_SIZE = 200;

// A value that cannot be used is ignored, not rejected: a bad ?limit must not
// turn a working list into an error page.
export const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const positiveInt = z.coerce.number().int().positive();

// Only a plain YYYY-MM-DD, and only a real day: JavaScript rolls "2026-02-31"
// forward to 3 March, so the round trip must give back the same string.
const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
        const parsed = toDateOnly(value);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    });

/** page/limit/search/from/to. Lists extend this with their own filters. */
export const listQuerySchema = z.object({
    page: lenient(positiveInt),
    // Capped, so one request cannot read a whole table as a single page.
    limit: lenient(positiveInt.transform((limit) => Math.min(limit, MAX_PAGE_SIZE))),
    search: lenient(z.string().trim().transform((term) => term || undefined)),
    from: lenient(isoDate),
    to: lenient(isoDate),
});

/**
 * An optional filter that must be valid when given. An empty value (a select
 * left on "All") counts as not given.
 */
export const optionalFilter = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** A "true" flag in the query string; anything else is false. */
export const queryFlag = z.unknown().optional().transform((value) => value === "true");

/** A tri-state "true" / "false" filter; anything else means no filter. */
export const queryBoolean = z.unknown().optional().transform((value) =>
    value === "true" ? true : value === "false" ? false : undefined
);

// A Prisma filter for the given column, or undefined when neither bound was
// supplied - spread into a `where` so an absent range changes nothing:
//
//     where: { owner_id, ...dateRangeWhere(options) }
//
// Both bounds are inclusive, matching the browser's gte/lte.
export const dateRangeWhere = (options: ListOptions, column = "date"): Record<string, unknown> => {
    if (!options.from && !options.to) return {};
    return {
        [column]: {
            ...(options.from ? { gte: toDateOnly(options.from) } : {}),
            ...(options.to ? { lte: endOfDay(options.to) } : {}),
        },
    };
};

type PageSlice = { skip: number; take: number };

// How many rows to skip, and how many to take. Undefined means "no paging" -
// the caller returns the whole list.
export const pageSlice = (options: ListOptions): PageSlice | undefined => {
    if (!options.limit) return undefined;
    const page = options.page ?? 1;
    return { skip: (page - 1) * options.limit, take: options.limit };
};

// The paging branch every list service shares. Without a limit the whole list
// comes back and its length is the total, so no count query runs. With one,
// the page and the count are fetched together.
//
//     const { rows, total } = await findPage(
//         options,
//         (page) => prisma.client.findMany({ where, orderBy, ...page }),
//         () => prisma.client.count({ where })
//     );
export const findPage = async <Row>(
    options: ListOptions,
    find: (page?: PageSlice) => Promise<Row[]>,
    count: () => Promise<number>
): Promise<{ rows: Row[]; total: number }> => {
    const slice = pageSlice(options);
    if (!slice) {
        const rows = await find();
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([find(slice), count()]);
    return { rows, total };
};

export const paginationMeta = (options: ListOptions, total: number) => {
    const limit = options.limit ?? total;
    const page = options.page ?? 1;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    return { page, limit, total, totalPages };
};
