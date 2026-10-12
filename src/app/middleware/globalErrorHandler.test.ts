import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import express, { NextFunction, Request, Response } from "express";
import z from "zod";
import { env } from "../../config/env.js";
import AppError from "../errorHelpers/AppError.js";
import { startTestServer, TestServer } from "../testing/testServer.js";
import { globalErrorHandler } from "./globalErrorHandler.js";
import { requestLogger } from "./requestLogger.js";

// A small app with the real request-id middleware, body parser and error
// handler, and routes that fail in each of the ways the handler sorts.
const app = express();
app.use(requestLogger);
app.use(express.json({ limit: "1kb" }));
app.post("/echo", (req: Request, res: Response) => {
    res.json(req.body);
});
app.get("/app-error", (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(403, "Not on this team"));
});
app.get("/crash", (_req: Request, _res: Response, next: NextFunction) => {
    next(new Error("connection string postgres://secret"));
});
app.get("/zod", (_req: Request, _res: Response, next: NextFunction) => {
    const result = z.object({ email: z.string() }).safeParse({});
    next(result.error);
});
app.use(globalErrorHandler);

let server: TestServer;
before(async () => {
    server = await startTestServer(app);
});
after(() => {
    server.close();
});

const originalNodeEnv = env.NODE_ENV;
afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
});

const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${server.base}${path}`, init);
    return { status: response.status, requestIdHeader: response.headers.get("x-request-id"), body: await response.json() };
};

const postJson = (body: string) =>
    call("/echo", { method: "POST", headers: { "content-type": "application/json" }, body });

describe("globalErrorHandler", () => {
    it("answers malformed JSON with 400", async () => {
        const { status, body } = await postJson("{not json");
        assert.equal(status, 400);
        assert.equal(body.message, "Request body is not valid JSON");
        assert.deepEqual(body.errorSource, [{ path: "body", message: "Request body is not valid JSON" }]);
    });

    it("answers an oversized body with 413", async () => {
        const { status, body } = await postJson(JSON.stringify({ note: "x".repeat(2048) }));
        assert.equal(status, 413);
        assert.equal(body.message, "Request body is too large");
    });

    it("keeps an AppError's status and message", async () => {
        const { status, body } = await call("/app-error");
        assert.equal(status, 403);
        assert.equal(body.success, false);
        assert.equal(body.message, "Not on this team");
        assert.deepEqual(body.errorSource, [{ path: "", message: "Not on this team" }]);
    });

    it("sends validation failures with errorSource paths", async () => {
        const { status, body } = await call("/zod");
        assert.equal(status, 400);
        assert.equal(body.message, "Validation failed");
        assert.equal(body.errorSource[0].path, "email");
    });

    it("hides an unexpected error's text in production, and drops error and stack", async () => {
        env.NODE_ENV = "production";
        const { status, body } = await call("/crash");
        assert.equal(status, 500);
        assert.equal(body.message, "Internal Server Error");
        assert.equal(body.error, undefined);
        assert.equal(body.stack, undefined);
    });

    it("shows the real message and the stack while developing", async () => {
        env.NODE_ENV = "development";
        const { status, body } = await call("/crash");
        assert.equal(status, 500);
        assert.match(body.message, /connection string/);
        assert.equal(typeof body.stack, "string");
    });

    it("puts the request id in the body and the header, and they match", async () => {
        const { body, requestIdHeader } = await call("/app-error");
        assert.equal(typeof body.requestId, "string");
        assert.equal(body.requestId, requestIdHeader);
    });
});
