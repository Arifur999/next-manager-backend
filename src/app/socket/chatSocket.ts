import type { Server } from "http";
import type { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../../config/env.js";
import { UserStatus } from "../../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { jwtUtils } from "../utils/jwt.js";
import { isAllowedOrigin } from "../shared/allowedOrigins.js";
import { canReadChat } from "../module/chat/chat.membership.js";
import { readAccessToken } from "./readAccessToken.js";

/**
 * The chat socket. A CLIENT CANNOT SUBSCRIBE TO ANYTHING: there is no join
 * message and no conversation id this file accepts, because a socket that
 * trusted one would be a cross-tenant read with no HTTP route to audit.
 *
 * A connection is a mailbox for ONE user id, proven on the handshake. Once a
 * message is stored over HTTP, its members are read from the database and
 * pushed to, so somebody removed from a group stops receiving it at once.
 * Delivery is best-effort: a thread is always fetched over HTTP on open.
 *
 * Connections live in this process's memory, so pushes go out over the chat bus
 * (Postgres LISTEN/NOTIFY) and every instance, the publisher included, delivers
 * to its own sockets - one delivery path.
 */

/** Every live connection, by the user it was proven to belong to. */
const sockets = new Map<string, Set<WebSocket>>();

type Authenticated = { userId: string; organizationId: string };

/**
 * The checks checkAuth makes, on the handshake and in the same order. Written
 * out again because the middleware works through req.user and next(); what must
 * not diverge is the set of checks.
 */
const authenticate = async (cookieHeader?: string): Promise<Authenticated | null> => {
    const accessToken = readAccessToken(cookieHeader);
    if (!accessToken) return null;

    const verified = jwtUtils.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET);
    if (!verified.success) return null;

    const userId: unknown = verified.decoded.userId;
    if (typeof userId !== "string") return null;

    // A database error here refuses the handshake; it must never reject unhandled.
    let user;
    try {
        user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, organization_id: true, role: true, status: true, token_version: true },
        });
    } catch {
        return null;
    }

    if (!user) return null;
    // A pending or suspended account has a valid token and must still be
    // refused, exactly as it is over HTTP.
    if (user.status !== UserStatus.active) return null;
    // A password change retires every token issued before it.
    if ((verified.decoded.tokenVersion ?? 0) !== user.token_version) return null;
    // A super_admin belongs to no agency and so is in no conversation. Nothing
    // would ever be pushed to them; refusing the socket says so plainly.
    if (!user.organization_id) return null;

    const subject = { userId: user.id, organizationId: user.organization_id, role: user.role };
    // Chat switched off on the permission grid gets no live copy of what the
    // HTTP reads refuse. A database error refuses, like the lookup above.
    try {
        if (!(await canReadChat(subject))) return null;
    } catch {
        return null;
    }

    return { userId: subject.userId, organizationId: subject.organizationId };
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
 * Push to specific people on THIS instance; only the chat bus calls it. Services
 * publish to the bus instead, because a direct local push would silently miss
 * every socket held by another instance. It knows nothing of conversations: the
 * member ids are read from the database before publishing.
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

        socket.on("error", () => socket.destroy());

        // The cookie is SameSite=Lax, so a sibling site could still open a socket
        // as the user. The Origin must be one CORS would accept.
        if (!isAllowedOrigin(request.headers.origin)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
        }

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
        }).catch(() => {
            socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
            socket.destroy();
        });
    });

    return wss;
};
