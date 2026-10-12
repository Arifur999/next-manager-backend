import z from "zod";

// Shared pieces for list endpoints that page, search and date-filter on the
// server.
//
// Two decisions worth knowing before using these:
//
//   - a search is a plain case-insensitive "contains", NOT a LIKE pattern.
//     Typing "50%" must look for those three characters, so the wildcards are
//     escaped. Prisma's `contains` passes the term straight into LIKE.
//   - paging is opt-in. Asking for no limit returns everything, so an endpoint
//     that has not been moved over to paging keeps behaving exactly as before.

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
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const positiveInt = z.coerce.number().int().positive();

// Only a plain YYYY-MM-DD, and only a real day: JavaScript rolls "2026-02-31"
// forward to 3 March, so the round trip must give back the same string.
const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
        const parsed = new Date(`${value}T00:00:00Z`);
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

export const parseListOptions = (query: Record<string, unknown>): ListOptions => {
    const { page, limit, search, from, to } = listQuerySchema.parse(query);
    return { page, limit, search, from, to };
};

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
            ...(options.from ? { gte: new Date(`${options.from}T00:00:00.000Z`) } : {}),
            ...(options.to ? { lte: new Date(`${options.to}T23:59:59.999Z`) } : {}),
        },
    };
};

// How many rows to skip, and how many to take. Undefined means "no paging" -
// the caller returns the whole list.
export const pageSlice = (options: ListOptions): { skip: number; take: number } | undefined => {
    if (!options.limit) return undefined;
    const page = options.page ?? 1;
    return { skip: (page - 1) * options.limit, take: options.limit };
};

export const paginationMeta = (options: ListOptions, total: number) => {
    const limit = options.limit ?? total;
    const page = options.page ?? 1;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    // totalPage is the old name, kept until the web app reads totalPages.
    return { page, limit, total, totalPages, totalPage: totalPages };
};
