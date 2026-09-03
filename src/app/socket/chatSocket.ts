import type { Server } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../../config/env.js";
import { UserStatus } from "../../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { jwtUtils } from "../utils/jwt.js";

/**
 * The chat socket.
 *
 * The rule this whole file exists to enforce:
 *
 *   A CLIENT CANNOT SUBSCRIBE TO ANYTHING.
 *
 * There is no "join" message, no room name a browser can send, and no
 * conversation id this file will accept from a connection. A socket that
 * believed an id it was handed would be a cross-tenant read with no HTTP route
 * to audit - the worst kind, because nothing in the request log would show it.
 *
 * Instead the connection is only ever a mailbox for ONE user id, proven on the
 * handshake. When a message is persisted over HTTP, the service asks the
 * database who is in that conversation and pushes to exactly those people's
 * sockets. Membership is therefore re-read from the database on every push
 * rather than cached on the connection, so somebody removed from a group stops
 * receiving it immediately rather than until they reconnect.
 *
 * Delivery is best-effort by design. Messages are persisted over HTTP first and
 * broadcast second; a dropped socket loses nothing, because the thread is
 * fetched over HTTP when the page opens.
 *
 * The connections live in THIS process's memory, which is what makes the
 * process stateful. Behind more than one instance, a message posted to A would
 * reach nobody holding a socket on B - so the push goes out over the chat bus
 * (Postgres LISTEN/NOTIFY) and every instance delivers to its own sockets.
 * There is one delivery path, not a local one and a remote one that could
 * drift: the publisher hears its own notification like everybody else.
 */

/** Every live connection, by the user it was proven to belong to. */
const sockets = new Map<string, Set<WebSocket>>();

type Authenticated = { userId: string; organizationId: string };

/**
 * The same proof checkAuth demands, on the handshake.
 *
 * Deliberately duplicated rather than reusing the Express middleware: that one
 * writes to `req.user` and calls `next()`, neither of which exists here. What
 * must not diverge is the SET of checks, so they are listed in the same order
 * and each says why it is here.
 */
const authenticate = async (cookieHeader?: string): Promise<Authenticated | null> => {
    if (!cookieHeader) return null;

    const accessToken = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("accessToken="))
        ?.slice("accessToken=".length);

    if (!accessToken) return null;

    const verified = jwtUtils.verifyToken(decodeURIComponent(accessToken), env.ACCESS_TOKEN_SECRET);
    if (!verified.success) return null;

    const user = await prisma.user.findUnique({
        where: { id: verified.decoded.userId },
        select: { id: true, organization_id: true, status: true, token_version: true },
    });

    if (!user) return null;
    // A pending or suspended account has a valid token and must still be
    // refused, exactly as it is over HTTP.
    if (user.status !== UserStatus.active) return null;
    // A password change retires every token issued before it.
    if ((verified.decoded.tokenVersion ?? 0) !== user.token_version) return null;
    // A super_admin belongs to no agency and so is in no conversation. Nothing
    // would ever be pushed to them; refusing the socket says so plainly.
    if (!user.organization_id) return null;

    return { userId: user.id, organizationId: user.organization_id };
};

const remember = (userId: string, socket: WebSocket) => {
    const existing = sockets.get(userId) ?? new Set<WebSocket>();
    existing.add(socket);
    sockets.set(userId, existing);
};

const forget = (userId: string, socket: WebSocket) => {
    const existing = sockets.get(userId);
    if (!existing) return;

    existing.delete(socket);
    // Dropped entirely rather than left as an empty Set, so a long-running
    // process does not accumulate one entry per person who ever connected.
    if (existing.size === 0) sockets.delete(userId);
};

/**
 * Push to specific people, by user id, on THIS instance only.
 *
 * The only way anything leaves this server over a socket. Not exported to the
 * services any more: they publish to the bus instead, and every instance -
 * including the one that published - arrives here. Routing a push straight to
 * local sockets would work perfectly on one instance and silently drop half the
 * deliveries on two.
 *
 * It has no concept of a conversation and cannot be asked for one; the member
 * ids are read from the database a moment before publishing.
 */
export const deliverLocally = (userIds: string[], payload: unknown) => {
    const body = JSON.stringify(payload);
    let delivered = 0;

    for (const userId of userIds) {
        for (const socket of sockets.get(userId) ?? []) {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(body);
                delivered += 1;
            }
        }
    }

    return delivered;
};

/** How many live connections there are, for the health endpoint to report. */
export const socketStats = () => ({
    users: sockets.size,
    connections: [...sockets.values()].reduce((total, set) => total + set.size, 0),
});

export const attachChatSocket = (server: Server) => {
    // noServer, not { server }: with the built-in handling the connection is
    // accepted first and closed afterwards, which means an unauthenticated
    // client is briefly a real socket. Handling the upgrade ourselves lets an
    // unproven handshake be destroyed before it ever becomes one.
    const wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket: Duplex, head) => {
        // Only our own path. Anything else is left alone rather than refused,
        // in case something else is ever mounted on this server.
        const { pathname } = new URL(request.url ?? "/", "http://localhost");
        if (pathname !== "/ws") return;

        void authenticate(request.headers.cookie).then((user) => {
            if (!user) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            wss.handleUpgrade(request, socket, head, (ws) => {
                remember(user.userId, ws);

                ws.on("close", () => forget(user.userId, ws));
                ws.on("error", () => forget(user.userId, ws));

                // Anything a client sends is read and thrown away. There is no
                // protocol in this direction on purpose: sending is an HTTP
                // request, so a message cannot be lost when a socket drops, and
                // there is nothing here to be tricked into subscribing.
                ws.on("message", () => {});

                ws.send(JSON.stringify({ type: "ready" }));
            });
        });
    });

    return wss;
};
