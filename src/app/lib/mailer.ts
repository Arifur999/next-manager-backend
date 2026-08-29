import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";

/**
 * Sending mail, with an honest answer when it cannot.
 *
 * SMTP rather than one provider's SDK: Resend, SendGrid, Postmark, Mailgun and
 * a plain Gmail account all speak it, so choosing a provider later is four
 * lines of .env rather than a rewrite.
 *
 * **When SMTP is not configured the mail is logged instead of sent, and the
 * caller is told which happened.** That is not a silent fallback - a password
 * reset that reports success while going nowhere is the worst outcome
 * available, because the user waits for an email that was never sent. Every
 * caller gets `{ delivered: false, reason }` and decides what to say.
 *
 * In development the logged version prints the link, so the whole flow can be
 * exercised end to end before anybody buys a mail plan.
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

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: Number(env.SMTP_PORT) || 587,
            // 465 is implicit TLS; everything else upgrades with STARTTLS.
            secure: Number(env.SMTP_PORT) === 465,
            auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
        });
    }

    return transporter;
};

export const sendMail = async (mail: Mail): Promise<MailResult> => {
    if (!isConfigured()) {
        // Logged, loudly, with the body - so a developer can follow the link
        // and a deployment missing its config is obvious in the output rather
        // than discovered by a user who never got their email.
        console.warn(
            `[mail] SMTP is not configured, so this was NOT sent:\n` +
                `      to: ${mail.to}\n` +
                `      subject: ${mail.subject}\n` +
                `      ${mail.text.replace(/\n/g, "\n      ")}`
        );

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
        console.error("[mail] send failed:", (error as Error).message);
        return { delivered: false, reason: "The mail server refused the message" };
    }
};

/**
 * The reset email.
 *
 * Kept plain on purpose: a password-reset message that looks like marketing is
 * the one people have been trained to distrust, and it is also the one most
 * likely to be filtered.
 */
export const passwordResetMail = (resetUrl: string, expiresInMinutes: number): Omit<Mail, "to"> => ({
    subject: "Reset your AGENCIO password",
    text: [
        "Somebody asked to reset the password on this account.",
        "",
        `Open this link to choose a new one: ${resetUrl}`,
        "",
        `The link works once and expires in ${expiresInMinutes} minutes.`,
        "If this was not you, nothing has changed and you can ignore this message.",
    ].join("\n"),
    html: `
        <p>Somebody asked to reset the password on this account.</p>
        <p><a href="${resetUrl}">Choose a new password</a></p>
        <p>The link works once and expires in ${expiresInMinutes} minutes.</p>
        <p>If this was not you, nothing has changed and you can ignore this message.</p>
    `,
});
