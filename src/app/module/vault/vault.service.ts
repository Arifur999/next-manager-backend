import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { CredentialAction } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { decryptSecret, encryptSecret, maskSecret } from "../../utils/crypto.js";
import { ICreateCredentialPayload, IUpdateCredentialPayload } from "./vault.validation.js";

/**
 * Client credentials.
 *
 * The rule that shapes this file: a password leaves the database in readable
 * form exactly once, on an explicit reveal, and that reveal is logged. Every
 * other path returns a mask.
 *
 * `password_cipher` is therefore never in a select for a list or a detail read
 * - it is only fetched inside revealCredential. That is deliberate: a field
 * that is never selected cannot be leaked by a response shape somebody changes
 * later without thinking about it.
 */

// What a list or detail read is allowed to see. No cipher columns.
const SAFE_FIELDS = {
    id: true,
    client_id: true,
    project_id: true,
    label: true,
    url: true,
    username: true,
    created_by: true,
    created_at: true,
    updated_at: true,
} as const;

const writeAccessLog = async (
    tx: Prisma.TransactionClient,
    credentialId: string,
    action: CredentialAction,
    user: IRequestUser,
    context: { ip?: string; userAgent?: string } = {}
) => {
    return tx.credentialAccessLog.create({
        data: {
            organization_id: user.organizationId,
            credential_id: credentialId,
            user_id: user.userId,
            action,
            ip: context.ip ?? "",
            user_agent: context.userAgent ?? "",
        },
    });
};

const getAllCredentials = async (user: IRequestUser, options: ListOptions = {}) => {
    // Search works on label / url / username, which is why those stay plain
    // text. The ciphertext is not searchable and should not be.
    const where: Prisma.CredentialWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(options.search
            ? {
                OR: [
                    { label: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { url: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { username: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { client: { name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const select = {
        ...SAFE_FIELDS,
        client: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, code: true } },
    };

    const slice = pageSlice(options);

    const withMask = (rows: Array<Record<string, unknown>>) =>
        rows.map((row) => ({ ...row, password: maskSecret() }));

    if (!slice) {
        const rows = await prisma.credential.findMany({ where, select, orderBy: { created_at: "desc" } });
        return { rows: withMask(rows), total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.credential.findMany({
            where,
            select,
            orderBy: { created_at: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.credential.count({ where }),
    ]);

    return { rows: withMask(rows), total };
};

/**
 * The one path that returns a real password.
 *
 * Logs before returning, in the same transaction, so a reveal cannot happen
 * without its log row - if the write fails, the caller gets nothing.
 */
const revealCredential = async (
    id: string,
    user: IRequestUser,
    context: { ip?: string; userAgent?: string }
) => {
    return prisma.$transaction(async (tx) => {
        const credential = await tx.credential.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true, label: true, username: true, password_cipher: true, notes_cipher: true },
        });

        if (!credential) {
            throw new AppError(status.NOT_FOUND, "Credential not found");
        }

        await writeAccessLog(tx, id, CredentialAction.revealed, user, context);

        // decryptSecret throws on a tampered row rather than returning
        // plausible rubbish - let that surface as a 500 rather than handing
        // back a wrong password somebody would try to use.
        return {
            id: credential.id,
            label: credential.label,
            username: credential.username,
            password: decryptSecret(credential.password_cipher),
            notes: credential.notes_cipher ? decryptSecret(credential.notes_cipher) : "",
        };
    });
};

const getAccessLog = async (id: string, user: IRequestUser) => {
    const credential = await prisma.credential.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!credential) {
        throw new AppError(status.NOT_FOUND, "Credential not found");
    }

    return prisma.credentialAccessLog.findMany({
        where: { credential_id: id, organization_id: user.organizationId },
        include: { user: { select: { id: true, full_name: true, email: true } } },
        orderBy: { created_at: "desc" },
        take: 200,
    });
};

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { client_id?: string | null; project_id?: string | null },
    user: IRequestUser
) => {
    if (payload.client_id) {
        const client = await tx.client.findFirst({
            where: { id: payload.client_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!client) throw new AppError(status.NOT_FOUND, "Client not found");
    }

    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: { id: payload.project_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });
        if (!project) throw new AppError(status.NOT_FOUND, "Project not found");
    }
};

const createCredential = async (
    payload: ICreateCredentialPayload,
    user: IRequestUser,
    context: { ip?: string; userAgent?: string }
) => {
    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);

        const credential = await tx.credential.create({
            data: {
                organization_id: user.organizationId,
                client_id: payload.client_id ?? null,
                project_id: payload.project_id ?? null,
                label: payload.label,
                url: payload.url ?? "",
                username: payload.username ?? "",
                password_cipher: encryptSecret(payload.password),
                // Free-text notes on a credential are as sensitive as the
                // password itself, so they get the same treatment.
                notes_cipher: payload.notes ? encryptSecret(payload.notes) : null,
                created_by: user.userId,
            },
            select: SAFE_FIELDS,
        });

        await writeAccessLog(tx, credential.id, CredentialAction.created, user, context);

        return { ...credential, password: maskSecret() };
    });
};

const updateCredential = async (
    id: string,
    payload: IUpdateCredentialPayload,
    user: IRequestUser,
    context: { ip?: string; userAgent?: string }
) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.credential.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Credential not found");
        }

        await assertReferences(tx, payload, user);

        const credential = await tx.credential.update({
            where: { id },
            data: {
                client_id: payload.client_id === undefined ? undefined : payload.client_id,
                project_id: payload.project_id === undefined ? undefined : payload.project_id,
                label: payload.label ?? undefined,
                url: payload.url ?? undefined,
                username: payload.username ?? undefined,
                // Absent means "leave it alone" - re-encrypting an unchanged
                // password on every edit would churn the ciphertext for nothing.
                password_cipher: payload.password ? encryptSecret(payload.password) : undefined,
                notes_cipher: payload.notes === undefined ? undefined : payload.notes ? encryptSecret(payload.notes) : null,
            },
            select: SAFE_FIELDS,
        });

        await writeAccessLog(tx, id, CredentialAction.updated, user, context);

        return { ...credential, password: maskSecret() };
    });
};

const deleteCredential = async (
    id: string,
    user: IRequestUser,
    context: { ip?: string; userAgent?: string }
) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.credential.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Credential not found");
        }

        await tx.credential.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        // Soft delete keeps the access log meaningful: "who saw this before it
        // was removed" is exactly the question worth being able to answer.
        await writeAccessLog(tx, id, CredentialAction.deleted, user, context);

        return { message: "Credential deleted successfully" };
    });
};

export const VaultService = {
    getAllCredentials,
    revealCredential,
    getAccessLog,
    createCredential,
    updateCredential,
    deleteCredential,
};
