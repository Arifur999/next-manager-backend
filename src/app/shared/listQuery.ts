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
    // download every row the workspace has ever had.
    from?: string;
    to?: string;
}

// LIKE treats % and _ as wildcards and \ as the escape character. A term the
// user typed has to be matched literally.
export const escapeLikeTerm = (term: string): string =>
    term.replace(/[\\%_]/g, (character) => `\\${character}`);

const positiveInt = (value: unknown): number | undefined => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return undefined;
    return parsed;
};

// Only a plain YYYY-MM-DD is accepted. Anything else is ignored rather than
// guessed at, so a malformed param widens the range instead of breaking it.
const isoDate = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return undefined;
    // JavaScript rolls impossible dates forward rather than rejecting them -
    // "2026-02-31" becomes 3 March. Comparing the round trip catches that, so a
    // typo drops the filter instead of quietly shifting the range.
    return parsed.toISOString().slice(0, 10) === value ? value : undefined;
};

// Reads page/limit/search/from/to off a request query. Anything unusable is
// ignored rather than rejected: a bad ?limit must not turn a working list into
// an error page.
export const parseListOptions = (query: Record<string, unknown>): ListOptions => {
    const search = typeof query.search === "string" ? query.search.trim() : "";
    return {
        page: positiveInt(query.page),
        limit: positiveInt(query.limit),
        search: search || undefined,
        from: isoDate(query.from),
        to: isoDate(query.to),
    };
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
    return {
        page,
        limit,
        total,
        totalPage: limit > 0 ? Math.ceil(total / limit) : 1,
    };
};
