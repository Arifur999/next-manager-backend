import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import z from "zod";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { startTestServer, TestServer } from "../testing/testServer.js";
import { validateRequest, validateRequestBy } from "./validateRequest.js";

const createSchema = z.object({
    name: z.string().min(1),
    quantity: z.number().default(1),
});

const app = express();
app.use(express.json());
// Stands in for a multipart form: the JSON payload arrives as a `data` text field.
app.use(express.urlencoded({ extended: true }));

// Stands in for checkAuth: the role comes from a header, or there is no user.
app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = req.get("x-test-role");
    if (role === Role.admin || role === Role.operations) {
        req.user = { userId: "u-1", organizationId: "org-1", role, email: "a@unit.test", name: "Unit", permissions: [] };
    }
    next();
});

app.post("/body", validateRequest(createSchema), (req: Request, res: Response) => {
    res.json({ body: req.body });
});
app.get(
    "/things/:id",
    validateRequest({ params: z.object({ id: z.uuid() }), query: z.object({ page: z.coerce.number().int().positive().optional() }) }),
    (req: Request, res: Response) => {
        res.json({ params: req.params, query: res.locals.query });
    }
);
app.patch(
    "/by-role",
    validateRequestBy((role) => (role === Role.admin ? z.object({ due_date: z.string() }) : z.object({ title: z.string() }))),
    (req: Request, res: Response) => {
        res.json({ body: req.body });
    }
);

// Reports what reached next(err), so the test sees the middleware's decision.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
        res.status(400).json({ kind: "zod", paths: err.issues.map((issue) => issue.path.join(".")) });
        return;
    }
    if (err instanceof AppError) {
        res.status(err.statusCode).json({ kind: "app", message: err.message });
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

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${server.base}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
};

describe("validateRequest with a body schema", () => {
    it("replaces the body with the parsed one: defaults applied, unknown keys dropped", async () => {
        const { status, json } = await send("POST", "/body", { name: "Logo", role: "admin" });
        assert.equal(status, 200);
        assert.deepEqual(json.body, { name: "Logo", quantity: 1 });
    });

    it("passes a failed parse to the error handler as a ZodError", async () => {
        const { status, json } = await send("POST", "/body", { quantity: "two" });
        assert.equal(status, 400);
        assert.deepEqual(json, { kind: "zod", paths: ["name", "quantity"] });
    });

    it("reads a multipart-style `data` field as the JSON payload", async () => {
        const response = await fetch(`${server.base}/body`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: JSON.stringify({ name: "Banner", quantity: 3 }) }),
        });
        assert.deepEqual(await response.json(), { body: { name: "Banner", quantity: 3 } });
    });

    it("refuses a `data` field that is not JSON, naming the field", async () => {
        const response = await fetch(`${server.base}/body`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: "{not json" }),
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { kind: "zod", paths: ["data"] });
    });
});

describe("validateRequest with params and query", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

    it("replaces params and puts the parsed query in res.locals.query", async () => {
        const { status, json } = await send("GET", `/things/${id}?page=2`);
        assert.equal(status, 200);
        assert.deepEqual(json, { params: { id }, query: { page: 2 } });
    });

    it("refuses a malformed id", async () => {
        const { status, json } = await send("GET", "/things/not-an-id");
        assert.equal(status, 400);
        assert.deepEqual(json.paths, ["id"]);
    });

    it("refuses a bad query value", async () => {
        const { status, json } = await send("GET", `/things/${id}?page=-1`);
        assert.equal(status, 400);
        assert.deepEqual(json.paths, ["page"]);
    });
});

describe("validateRequestBy", () => {
    it("picks the schema from the caller's role", async () => {
        const admin = await send("PATCH", "/by-role", { due_date: "2026-10-01", title: "x" }, { "x-test-role": Role.admin });
        assert.deepEqual(admin.json.body, { due_date: "2026-10-01" });

        const operations = await send("PATCH", "/by-role", { due_date: "2026-10-01", title: "x" }, { "x-test-role": Role.operations });
        assert.deepEqual(operations.json.body, { title: "x" });
    });

    it("answers 401 when no user is on the request", async () => {
        const { status, json } = await send("PATCH", "/by-role", { title: "x" });
        assert.equal(status, 401);
        assert.deepEqual(json, { kind: "app", message: "Not authenticated" });
    });
});
