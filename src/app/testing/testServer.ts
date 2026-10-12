import { once } from "node:events";
import { Server } from "node:http";
import { Application } from "express";

export type TestServer = { base: string; close: () => void };

/** Listens on a free port so a test can call the app over real HTTP. */
export const startTestServer = async (app: Application): Promise<TestServer> => {
    const server: Server = app.listen(0);
    await once(server, "listening");

    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a TCP address");

    return { base: `http://127.0.0.1:${address.port}`, close: () => server.close() };
};
