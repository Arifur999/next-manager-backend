import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateRangeWhere, escapeLikeTerm, findPage, pageSlice, paginationMeta, parseListOptions } from "./listQuery.js";

describe("parseListOptions", () => {
    it("reads page, limit, search and dates", () => {
        assert.deepEqual(parseListOptions({ page: "2", limit: "25", search: "  acme ", from: "2026-09-01", to: "2026-09-30" }), {
            page: 2,
            limit: 25,
            search: "acme",
            from: "2026-09-01",
            to: "2026-09-30",
        });
    });

    it("ignores a bad limit or page instead of failing", () => {
        const options = parseListOptions({ page: "0", limit: "abc" });
        assert.equal(options.page, undefined);
        assert.equal(options.limit, undefined);
        assert.equal(parseListOptions({ limit: "1.5" }).limit, undefined);
    });

    it("caps the page size at 200", () => {
        assert.equal(parseListOptions({ limit: "100000000" }).limit, 200);
        assert.equal(parseListOptions({ limit: "50" }).limit, 50);
    });

    it("drops an impossible date rather than rolling it forward", () => {
        assert.equal(parseListOptions({ from: "2026-02-31" }).from, undefined);
    });

    it("treats a blank search as none", () => {
        assert.equal(parseListOptions({ search: "   " }).search, undefined);
    });
});

describe("dateRangeWhere", () => {
    it("is empty without bounds", () => {
        assert.deepEqual(dateRangeWhere({}), {});
    });

    it("covers both whole days, inclusive", () => {
        assert.deepEqual(dateRangeWhere({ from: "2026-09-01", to: "2026-09-30" }), {
            date: { gte: new Date("2026-09-01T00:00:00.000Z"), lte: new Date("2026-09-30T23:59:59.999Z") },
        });
    });

    it("uses the column it is given", () => {
        assert.deepEqual(Object.keys(dateRangeWhere({ from: "2026-09-01" }, "issue_date")), ["issue_date"]);
    });
});

describe("escapeLikeTerm", () => {
    it("matches wildcards and the escape character literally", () => {
        assert.equal(escapeLikeTerm("50%_\\"), "50\\%\\_\\\\");
    });
});

describe("pageSlice", () => {
    it("is undefined without a limit, so the whole list comes back", () => {
        assert.equal(pageSlice({ page: 3 }), undefined);
    });

    it("skips whole pages", () => {
        assert.deepEqual(pageSlice({ page: 3, limit: 20 }), { skip: 40, take: 20 });
    });
});

describe("paginationMeta", () => {
    it("an unpaged list is one page of everything", () => {
        assert.deepEqual(paginationMeta({}, 42), { page: 1, limit: 42, total: 42, totalPages: 1, totalPage: 1 });
    });

    it("rounds pages up", () => {
        assert.equal(paginationMeta({ limit: 10 }, 41).totalPages, 5);
    });

    it("an empty unpaged list still reports one page", () => {
        assert.equal(paginationMeta({}, 0).totalPages, 1);
    });

    it("an empty paged list reports zero pages", () => {
        assert.equal(paginationMeta({ limit: 10 }, 0).totalPages, 0);
    });
});

describe("findPage", () => {
    const fakes = (rows: string[], total: number) => {
        const calls = { find: [] as Array<{ skip: number; take: number } | undefined>, count: 0 };
        const find = async (page?: { skip: number; take: number }) => {
            calls.find.push(page);
            return rows;
        };
        const count = async () => {
            calls.count += 1;
            return total;
        };
        return { calls, find, count };
    };

    it("loads the whole list once without a limit and makes no count query", async () => {
        const { calls, find, count } = fakes(["a", "b", "c"], 99);
        assert.deepEqual(await findPage({}, find, count), { rows: ["a", "b", "c"], total: 3 });
        assert.deepEqual(calls.find, [undefined]);
        assert.equal(calls.count, 0);
    });

    it("passes the page slice to find and takes the total from count", async () => {
        const { calls, find, count } = fakes(["k"], 41);
        assert.deepEqual(await findPage({ page: 3, limit: 20 }, find, count), { rows: ["k"], total: 41 });
        assert.deepEqual(calls.find, [{ skip: 40, take: 20 }]);
        assert.equal(calls.count, 1);
    });
});
