/**
 * Does the mail configuration actually work.
 *
 * Exists because the failure mode is silent: a wrong SMTP password produces a
 * password-reset flow that looks fine from the outside and delivers nothing,
 * and the only sign is a line in the server log nobody is watching.
 *
 * Run:  npm run test:mail                 check the credentials only
 *       npm run test:mail you@email.com   and send a real message there
 */

import nodemailer from "nodemailer";
import { env } from "../src/config/env.js";

const configured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);

console.log("\n--- what is configured ---");
console.log(`  SMTP_HOST      ${env.SMTP_HOST || "EMPTY"}`);
console.log(`  SMTP_PORT      ${env.SMTP_PORT || "EMPTY"}`);
console.log(`  SMTP_USER      ${env.SMTP_USER || "EMPTY"}`);
// Length only. Printing a live credential into a terminal is how it ends up in
// a screenshot, and the length is what actually diagnoses a placeholder.
console.log(`  SMTP_PASSWORD  ${env.SMTP_PASSWORD ? `set, ${env.SMTP_PASSWORD.length} characters` : "EMPTY"}`);
console.log(`  MAIL_FROM      ${env.MAIL_FROM || "unset - falls back to SMTP_USER"}`);

if (!configured) {
    console.log(
        "\nNot configured, so password reset links are logged to the server console" +
            "\ninstead of sent. That is intentional and the app runs fine - but nobody" +
            "\noutside the server can recover a password."
    );
    process.exit(0);
}

// The two mistakes that produce the same unhelpful 535 from every provider.
const warnings: string[] = [];

if (/yourdomain\.com|example\.com/i.test(env.MAIL_FROM)) {
    warnings.push(
        "MAIL_FROM is still the placeholder from .env.example. Providers refuse a" +
            "\n    From address on a domain they have not verified."
    );
}

if (env.SMTP_HOST.includes("resend") && !env.SMTP_PASSWORD.startsWith("re_")) {
    warnings.push("A Resend API key starts with 're_'. This one does not.");
}

if (env.SMTP_HOST.includes("gmail") && env.SMTP_PASSWORD.length !== 16 && env.SMTP_PASSWORD.replace(/\s/g, "").length !== 16) {
    warnings.push(
        "Gmail wants a 16-character App Password, not your account password." +
            "\n    Google Account > Security > 2-Step Verification > App passwords."
    );
}

if (warnings.length > 0) {
    console.log("\n--- likely problems ---");
    for (const warning of warnings) console.log(`  - ${warning}`);
}

const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
});

console.log("\n--- connecting ---");

try {
    await transporter.verify();
    console.log("  The server accepted these credentials.");
} catch (error) {
    const message = (error as Error).message;
    console.log(`  Refused: ${message}`);

    // The provider's own message is terse and identical for several different
    // mistakes, so the common ones are named here.
    if (/535|credentials|auth/i.test(message)) {
        console.log(
            "\n  535 means the username or password was rejected. What goes in" +
                "\n  SMTP_USER differs per provider and is the usual culprit:" +
                "\n    Resend    -> the literal word 'resend', password is the re_ API key" +
                "\n    SendGrid  -> the literal word 'apikey', password is the SG. key" +
                "\n    Brevo     -> your login email, password is the SMTP key (not the account password)" +
                "\n    Gmail     -> your full address, password is a 16-char App Password"
        );
    }

    process.exit(1);
}

const recipient = process.argv[2];

if (!recipient) {
    console.log("\n  Credentials are good. To send a real test message:");
    console.log("    npm run test:mail you@youremail.com\n");
    process.exit(0);
}

console.log(`\n--- sending to ${recipient} ---`);

try {
    const info = await transporter.sendMail({
        from: env.MAIL_FROM || env.SMTP_USER,
        to: recipient,
        subject: "AGENCIO mail test",
        text: "If you are reading this, password reset emails will reach your users.",
        html: "<p>If you are reading this, password reset emails will reach your users.</p>",
    });

    console.log(`  Accepted for delivery: ${info.messageId}`);
    console.log("  Check the inbox - and the spam folder, which is where an");
    console.log("  unverified sending domain usually lands.\n");
} catch (error) {
    const message = (error as Error).message;
    console.log(`  Send failed: ${message}`);

    if (/from|sender|domain|verif/i.test(message)) {
        console.log(
            "\n  The credentials worked but the From address was refused. Either" +
                "\n  verify that domain with the provider, or use an address the" +
                "\n  provider already owns for you."
        );
    }

    process.exit(1);
}
