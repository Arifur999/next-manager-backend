import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { startTestServer, TestServer } from "../testing/testServer.js";
import { requirePermission } from "./requirePermission.js";

const app = express();

// Stands in for checkAuth: role and permissions come from headers.
app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = req.get("x-test-role");
    if (role === Role.admin || role === Role.super_admin) {
        const permissions = (req.get("x-test-permissions") ?? "").split(",").filter(Boolean);
        req.user = { userId: "u-1", organizationId: "", role, email: "op@unit.test", name: "Op", permissions };
    }
    next();
});

app.get("/plans", requirePermission("platform.plans.manage"), (_req: Request, res: Response) => {
    res.json({ ok: true });
});
app.get("/finance", requirePermission("platform.finance.view", "platform.expenses.manage"), (_req: Request, res: Response) => {
    res.json({ ok: true });
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ message: err.message });
        return;
    }
    next(err);
});

let server: TestServer;
before(async () => {
    server = await startTestServer(app);
});
after(() => {
    server.close();
});

const get = async (path: string, role?: Role, permissions: string[] = []) => {
    const headers: Record<string, string> = role ? { "x-test-role": role, "x-test-permissions": permissions.join(",") } : {};
    const response = await fetch(`${server.base}${path}`, { headers });
    return { status: response.status, json: await response.json() };
};

describe("requirePermission", () => {
    it("lets a company admin through whatever is listed", async () => {
        assert.equal((await get("/plans", Role.admin, ["platform.companies.view"])).status, 200);
    });

    it("lets an operator with no stored permissions through, so the first one is never locked out", async () => {
        assert.equal((await get("/plans", Role.super_admin, [])).status, 200);
    });

    it("lets an operator through who holds any one of several names", async () => {
        assert.equal((await get("/finance", Role.super_admin, ["platform.expenses.manage"])).status, 200);
    });

    it("refuses an operator without it, naming what is missing", async () => {
        const { status, json } = await get("/finance", Role.super_admin, ["platform.plans.manage"]);
        assert.equal(status, 403);
        assert.match(json.message, /platform\.finance\.view or platform\.expenses\.manage/);
    });

    it("answers 401 when no user is on the request", async () => {
        assert.equal((await get("/plans")).status, 401);
    });
});
