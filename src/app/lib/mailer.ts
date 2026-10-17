import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import type { PlatformBrand } from "../shared/platformSettings.js";
import { logger } from "./logger.js";

/**
 * Sending mail, with an honest answer when it cannot. SMTP rather than one
 * provider's SDK, so changing provider is a few lines of .env.
 *
 * Without SMTP the mail is logged instead of sent and the caller gets
 * `{ delivered: false, reason }`, never a false success. In development the log
 * shows the link, so every flow works end to end without a mail plan.
 */

export type MailResult =
    | { delivered: true }
    | { delivered: false; reason: string };

type Mail = {
    to: string;
    subject: string;
    text: string;
    html: string;
};

const isConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);

/**
 * Whether mail works, for the settings screen: host, port and from-address
 * only. The password is never read back out of the process that holds it.
 */
export const getMailerStatus = () => ({
    configured: isConfigured(),
    host: env.SMTP_HOST || "",
    port: env.SMTP_PORT,
    /** What recipients see in the From line. */
    from: env.MAIL_FROM || env.SMTP_USER || "",
    /** Which piece is missing, when one is. */
    missing: [
        env.SMTP_HOST ? null : "SMTP_HOST",
        env.SMTP_USER ? null : "SMTP_USER",
        env.SMTP_PASSWORD ? null : "SMTP_PASSWORD",
    ].filter((name): name is string => name !== null),
});

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            // 465 is implicit TLS; everything else upgrades with STARTTLS.
            secure: env.SMTP_PORT === 465,
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
        });
    }

    return transporter;
};

export const sendMail = async (mail: Mail): Promise<MailResult> => {
    if (!isConfigured()) {
        // The body carries reset and invite links (bearer tokens), so it is
        // only printed in development, where a developer follows it by hand.
        logger.warn("SMTP is not configured, so this mail was NOT sent", {
            to: mail.to,
            subject: mail.subject,
            ...(env.NODE_ENV === "development" ? { body: mail.text } : {}),
        });

        return {
            delivered: false,
            reason: "SMTP is not configured on this server",
        };
    }

    try {
        await getTransporter().sendMail({
            from: env.MAIL_FROM || env.SMTP_USER,
            to: mail.to,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
        });

        return { delivered: true };
    } catch (error) {
        // Never rethrown. A mail provider being down must not turn into a 500
        // on a route whose real work already succeeded.
        logger.error("Mail send failed", { error });
        return { delivered: false, reason: "The mail server refused the message" };
    }
};

/**
 * Free text on its way into an HTML body: announcements are typed by a person,
 * and a `<` they type must arrive as a `<`, not as a tag.
 */
const escapeHtml = (value: string) =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/**
 * The last line of every message. The support address appears only when one is
 * set; an invented one would be written to and never read.
 */
const signOff = (brand: PlatformBrand) =>
    brand.supportEmail
        ? `- The ${brand.productName} team. Questions: ${brand.supportEmail}`
        : `- The ${brand.productName} team`;

/**
 * The reset email, plain on purpose: a reset that looks like marketing is the
 * one people distrust and filters catch.
 */
export const passwordResetMail = (
    resetUrl: string,
    expiresInMinutes: number,
    brand: PlatformBrand
): Omit<Mail, "to"> => ({
    subject: `Reset your ${brand.productName} password`,
    text: [
        "Somebody asked to reset the password on this account.",
        "",
        `Open this link to choose a new one: ${resetUrl}`,
        "",
        `The link works once and expires in ${expiresInMinutes} minutes.`,
        "If this was not you, nothing has changed and you can ignore this message.",
        "",
        signOff(brand),
    ].join("\n"),
    html: `
        <p>Somebody asked to reset the password on this account.</p>
        <p><a href="${resetUrl}">Choose a new password</a></p>
        <p>The link works once and expires in ${expiresInMinutes} minutes.</p>
        <p>If this was not you, nothing has changed and you can ignore this message.</p>
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
});

/**
 * The invite to join the platform team. Says the link is single-use and that
 * approval follows, so nobody who accepts is left guessing. The address is not
 * printed: the link is bound to it, and printing it only helps a wrong recipient.
 */
export const platformInviteMail = (
    joinUrl: string,
    expiresAt: Date,
    invitedBy: string,
    brand: PlatformBrand
): Omit<Mail, "to"> => {
    const expires = expiresAt.toUTCString();

    return {
        subject: `You have been invited to run ${brand.productName}`,
        text: [
            `${invitedBy} has invited you to the ${brand.productName} platform team.`,
            "",
            `Open this link to set your password: ${joinUrl}`,
            "",
            `It works once and expires on ${expires}.`,
            "After you accept, somebody already on the team has to approve you before you can sign in.",
            "",
            "If you were not expecting this, ignore it - the link does nothing until it is used.",
            "",
            signOff(brand),
        ].join("\n"),
        html: `
        <p>${escapeHtml(invitedBy)} has invited you to the ${escapeHtml(brand.productName)} platform team.</p>
        <p><a href="${joinUrl}">Set your password</a></p>
        <p>It works once and expires on ${escapeHtml(expires)}.</p>
        <p>After you accept, somebody already on the team has to approve you before you can sign in.</p>
        <p>If you were not expecting this, ignore it - the link does nothing until it is used.</p>
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
    };
};

/**
 * The invite that brings an agency onto the platform. It hands over a
 * workspace, so it says which plan they are being put on before they sign up.
 */
export const agencyInviteMail = (
    joinUrl: string,
    expiresAt: Date,
    companyName: string,
    trialDays: number,
    brand: PlatformBrand
): Omit<Mail, "to"> => {
    const expires = expiresAt.toUTCString();
    const what = companyName
        ? `a workspace for ${companyName}`
        : "your own workspace";
    const terms =
        trialDays > 0
            ? `You get ${trialDays} days to try everything before it has to be paid for.`
            : "It is on a paid plan from the moment you open it.";

    return {
        subject: `Your ${brand.productName} agency is ready to open`,
        text: [
            `You have been invited to open ${what} on ${brand.productName}.`,
            "",
            `Open this link to set your password: ${joinUrl}`,
            "",
            terms,
            "Once you are in, you add your own sales people, project managers and operations team - they never go through us.",
            "",
            `The link works once and expires on ${expires}.`,
            "",
            signOff(brand),
        ].join("\n"),
        html: `
        <p>You have been invited to open ${escapeHtml(what)} on ${escapeHtml(brand.productName)}.</p>
        <p><a href="${joinUrl}">Set your password and open it</a></p>
        <p>${escapeHtml(terms)}</p>
        <p>Once you are in, you add your own sales people, project managers and operations team - they never go through us.</p>
        <p>The link works once and expires on ${escapeHtml(expires)}.</p>
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
    };
};

/**
 * The invite to join an agency's team. Names the agency, since people work with
 * several, and says approval follows, like the operator invite.
 */
export const teamInviteMail = (
    joinUrl: string,
    expiresAt: Date,
    agencyName: string,
    invitedBy: string,
    brand: PlatformBrand
): Omit<Mail, "to"> => {
    const expires = expiresAt.toUTCString();

    return {
        subject: `${invitedBy} has invited you to join ${agencyName}`,
        text: [
            `${invitedBy} has invited you to the team at ${agencyName}.`,
            "",
            `Open this link to set your password: ${joinUrl}`,
            "",
            `It works once and expires on ${expires}.`,
            "After you accept, an admin has to approve you before you can sign in.",
            "",
            "If you were not expecting this, ignore it - the link does nothing until it is used.",
            "",
            signOff(brand),
        ].join("\n"),
        html: `
        <p>${escapeHtml(invitedBy)} has invited you to the team at ${escapeHtml(agencyName)}.</p>
        <p><a href="${joinUrl}">Set your password</a></p>
        <p>It works once and expires on ${escapeHtml(expires)}.</p>
        <p>After you accept, an admin has to approve you before you can sign in.</p>
        <p>If you were not expecting this, ignore it - the link does nothing until it is used.</p>
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
    };
};

/**
 * A platform announcement, emailed. Blank lines become paragraphs and nothing
 * else does: it is written in a textarea, and every formatting rule is one more
 * way for it to arrive broken.
 */
export const announcementMail = (
    title: string,
    body: string,
    recipientName: string,
    brand: PlatformBrand
): Omit<Mail, "to"> => ({
    subject: title,
    text: [`Hi ${recipientName},`, "", body, "", signOff(brand)].join("\n"),
    html: `
        <p>Hi ${escapeHtml(recipientName)},</p>
        <h2 style="font-size:18px;margin:16px 0 8px">${escapeHtml(title)}</h2>
        ${body
            .split(/\n{2,}/)
            .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
            .join("\n        ")}
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
});

/** What a notification email says, beside the brand. */
export interface NotificationNotice {
    title: string;
    body: string;
    /** The catalogue's sentence for the event, such as "An invoice goes overdue". */
    eventLabel: string;
    agencyName: string;
    recipientName: string;
    /** Where "Open" goes: the web app's sign-in, which forwards a signed-in person home. */
    link: string;
}

/**
 * A bell notification, emailed because the agency turned email on for its
 * event. It says why it arrived and who can switch it off, so it reads as the
 * agency's own message rather than marketing. The subject is folded onto one
 * line: titles carry what people typed.
 */
export const notificationMail = (notice: NotificationNotice, brand: PlatformBrand): Omit<Mail, "to"> => {
    const agency = notice.agencyName || "Your agency";
    const why = `${agency} emails this when: ${notice.eventLabel}. An admin can switch it off in the notification settings.`;
    const bodyLines = notice.body ? ["", notice.body] : [];

    return {
        subject: notice.title.replace(/\s+/g, " ").trim(),
        text: [
            `Hi ${notice.recipientName},`,
            "",
            notice.title,
            ...bodyLines,
            "",
            `Open ${brand.productName}: ${notice.link}`,
            "",
            why,
            "",
            signOff(brand),
        ].join("\n"),
        html: `
        <p>Hi ${escapeHtml(notice.recipientName)},</p>
        <p><strong>${escapeHtml(notice.title)}</strong></p>
        ${notice.body ? `<p>${escapeHtml(notice.body).replace(/\n/g, "<br />")}</p>` : ""}
        <p><a href="${escapeHtml(notice.link)}">Open ${escapeHtml(brand.productName)}</a></p>
        <p style="color:#666;font-size:13px">${escapeHtml(why)}</p>
        <p style="color:#666;font-size:13px">${escapeHtml(signOff(brand))}</p>
    `,
    };
};
