/**
 * Does a message posted to one instance reach a socket held by another?
 *
 * This is the whole claim the chat bus exists to make, and nothing else checks
 * it. The smoke suite runs against one process, where a push would work even
 * with no bus at all — so it would pass just as happily on the broken version.
 *
 * So this starts a SECOND backend on another port, holds a socket open against
 * it, posts a message to the first, and waits. If the two processes cannot hear
 * each other, nothing arrives and this fails.
 *
 * Run:  npm run test:chat-bus   (with the usual server up on 5000)
 */

import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const PRIMARY = "http://localhost:5000";
const SECOND_PORT = 5099;
const API = `${PRIMARY}/api/v1`;
const stamp = Date.now();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
        console.log(`  PASS  ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

const call = async (method: string, path: string, body?: unknown, cookie = "") => {
    const res = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
        cookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
    };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- two people
const email = `bus${stamp}@agencio.test`;
await call("POST", "/auth/register", {
    organization_name: "Bus Co",
    full_name: "Bus Admin",
    email,
    password: "Passw0rd123",
});
const admin = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;

const mateEmail = `busmate${stamp}@agencio.test`;
const made = await call(
    "POST",
    "/users",
    { full_name: "Bus Mate", email: mateEmail, password: "Passw0rd123", role: "operations" },
    admin
);
check("a colleague to talk to", made.status === 201, `${made.status} ${made.json.message}`);
const mateId = (made.json.data as { id: string })?.id;
const mate = (await call("POST", "/auth/login", { email: mateEmail, password: "Passw0rd123" })).cookie;

const conversation = await call("POST", "/chat", { type: "direct", member_ids: [mateId] }, admin);
check("a conversation between them", conversation.status === 201, `${conversation.status}`);
const conversationId = (conversation.json.data as { id: string })?.id;

// ---------------------------------------------------------------- instance two
console.log(`\nstarting a second instance on ${SECOND_PORT}...`);

const second = spawn("npx", ["tsx", "-r", "dotenv/config", "src/server.ts"], {
    env: { ...process.env, PORT: String(SECOND_PORT) },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
});

let secondLog = "";
second.stdout?.on("data", (chunk: Buffer) => {
    secondLog += chunk.toString();
});
second.stderr?.on("data", (chunk: Buffer) => {
    secondLog += chunk.toString();
});

const stop = () => {
    if (!second.killed) second.kill();
};

// Wait for it to be both listening AND on the bus. Listening alone is not
// enough: a socket served by a process that cannot hear the bus yet would be a
// false failure, and chasing that would waste an afternoon.
let up = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(500);
    if (secondLog.includes("Chat bus listening")) {
        try {
            const res = await fetch(`http://localhost:${SECOND_PORT}/`);
            if (res.ok) {
                up = true;
                break;
            }
        } catch {
            // Not yet.
        }
    }
}

check("the second instance is up and on the bus", up, secondLog.slice(-400));

if (!up) {
    stop();
    console.log(`\n${failures} CHECK(S) FAILED\n`);
    process.exit(1);
}

// ---------------------------------------------------------------- the proof
const received: Array<Record<string, unknown>> = [];
const socket = new WebSocket(`ws://localhost:${SECOND_PORT}/ws`, {
    headers: { Cookie: mate },
});

const connected = await new Promise<boolean>((resolve) => {
    socket.on("open", () => resolve(true));
    socket.on("error", () => resolve(false));
});
socket.on("message", (raw: Buffer) => received.push(JSON.parse(raw.toString())));

check("a socket connects to the SECOND instance", connected);

await wait(300);

// Posted to the FIRST instance. Nothing about this request touches the process
// holding the socket.
const sent = await call(
    "POST",
    `/chat/${conversationId}/messages`,
    { body: "Across the instances" },
    admin
);
check("a message posts to the FIRST instance", sent.status === 201, `${sent.status} ${sent.json.message}`);

await wait(1500);

const messages = received.filter((event) => event.type === "message");
check(
    "and reaches the socket on the second",
    messages.length === 1,
    `${messages.length} received: ${JSON.stringify(received)}`
);
check(
    "naming the conversation to refetch",
    messages[0]?.conversation_id === conversationId,
    JSON.stringify(messages[0])
);

// The message itself is not in the payload, and does not need to be: the HTTP
// read is what carries it, on either instance.
const thread = await fetch(`http://localhost:${SECOND_PORT}/api/v1/chat/${conversationId}/messages`, {
    headers: { Cookie: mate },
});
const threadJson = (await thread.json()) as { data?: Array<{ body: string }> };
check(
    "and the second instance serves the message over HTTP",
    (threadJson.data ?? []).some((m) => m.body === "Across the instances"),
    JSON.stringify((threadJson.data ?? []).map((m) => m.body))
);

socket.close();
stop();

console.log(`\n${failures === 0 ? "THE INSTANCES CAN HEAR EACH OTHER" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
