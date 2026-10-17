import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserStatus } from "../../generated/prisma/enums.js";
import { notificationMail } from "../lib/mailer.js";
import { planDelivery, type NotifyPerson } from "./notify.js";

const person = (id: string, status: UserStatus = UserStatus.active): NotifyPerson => ({
    id,
    email: `${id}@unit.test`,
    full_name: `Person ${id}`,
    status,
});

const actor = person("actor");
const admin = person("admin");
const suspended = person("suspended", UserStatus.suspended);

describe("planDelivery", () => {
    it("mails nobody while the rule leaves email off, which is the default", () => {
        const plan = planDelivery({ in_app: true, email: false }, [actor, admin], actor.id);
        assert.deepEqual(plan.inApp.map((p) => p.id), ["admin"]);
        assert.deepEqual(plan.mail, []);
    });

    it("mails everybody the event reached when email is on, never the actor", () => {
        const plan = planDelivery({ in_app: true, email: true }, [actor, admin], actor.id);
        assert.deepEqual(plan.mail.map((p) => p.id), ["admin"]);
    });

    it("does not mail somebody who cannot sign in, though the bell still records it", () => {
        const plan = planDelivery({ in_app: true, email: true }, [admin, suspended], actor.id);
        assert.deepEqual(plan.inApp.map((p) => p.id), ["admin", "suspended"]);
        assert.deepEqual(plan.mail.map((p) => p.id), ["admin"]);
    });

    it("can mail without writing to the bell", () => {
        const plan = planDelivery({ in_app: false, email: true }, [admin], actor.id);
        assert.deepEqual(plan.inApp, []);
        assert.deepEqual(plan.mail.map((p) => p.id), ["admin"]);
    });
});

describe("notificationMail", () => {
    const brand = { productName: "AGENCIO", supportEmail: "" };
    const notice = {
        title: "INV-0007 is\noverdue",
        body: "Acme owes $500.00 <due 2026-10-16>",
        eventLabel: "An invoice goes overdue",
        agencyName: "Acme & Co",
        recipientName: "Rina",
        link: "http://localhost:3000/login",
    };

    it("puts the title on one subject line", () => {
        assert.equal(notificationMail(notice, brand).subject, "INV-0007 is overdue");
    });

    it("says what happened, where to open it, and why it was sent", () => {
        const { text } = notificationMail(notice, brand);
        assert.match(text, /^Hi Rina,/);
        assert.match(text, /Acme owes \$500\.00/);
        assert.match(text, /Open AGENCIO: http:\/\/localhost:3000\/login/);
        assert.match(text, /Acme & Co emails this when: An invoice goes overdue\. An admin can switch it off/);
    });

    it("escapes what people typed in the HTML body", () => {
        const { html } = notificationMail(notice, brand);
        assert.ok(html.includes("&lt;due 2026-10-16&gt;"));
        assert.ok(html.includes("Acme &amp; Co"));
        assert.ok(!html.includes("<due"));
    });

    it("leaves the body paragraph out when there is none", () => {
        const { text, html } = notificationMail({ ...notice, body: "" }, brand);
        assert.ok(!text.includes("undefined"));
        assert.equal((html.match(/<p>/g) ?? []).length, 3);
    });
});
