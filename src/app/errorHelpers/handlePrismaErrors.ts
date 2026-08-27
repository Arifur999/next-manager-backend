import status from "http-status";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ISimplifiedError } from "../interfaces/error.interfaces.js";

// Prisma messages carry the detail that makes them useful while developing and
// risky in production: P2010 (raw query failure) embeds the PostgreSQL error,
// which echoes table and column names back to whoever triggered it. In
// production the caller gets a fixed sentence and the real message goes to the
// server log instead, where it is still there to read.
const safeMessage = (error: { code?: string; message: string }, fallback: string): string => {
    if (env.NODE_ENV !== "production") return error.message || fallback;
    console.error(`[prisma] ${error.code ?? "unknown"}: ${error.message}`);
    return fallback;
};

export const handlePrismaClientKnownRequestError = (
    error: Prisma.PrismaClientKnownRequestError
): ISimplifiedError => {
    let message = "Database request failed";
    let statusCode: number = status.BAD_REQUEST;

    switch (error.code) {
        case "P2002": {
            const target = Array.isArray(error.meta?.target)
                ? (error.meta?.target as string[]).join(", ")
                : String(error.meta?.target || "field");
            message = `Duplicate value for unique field: ${target}`;
            statusCode = status.CONFLICT;
            break;
        }
        case "P2003":
            message = "This record is linked with other records, operation not allowed";
            statusCode = status.CONFLICT;
            break;
        case "P2025":
            message = (error.meta?.cause as string) || "Record not found";
            statusCode = status.NOT_FOUND;
            break;
        default:
            message = safeMessage(error, "Database request failed");
            break;
    }

    return {
        statusCode,
        message,
        errorSource: [{ path: "", message }],
    };
};

export const handlePrismaClientUnknownError = (
    error: Prisma.PrismaClientUnknownRequestError
): ISimplifiedError => {
    const message = safeMessage(error, "Unknown database error");
    return {
        statusCode: status.INTERNAL_SERVER_ERROR,
        message,
        errorSource: [{ path: "", message }],
    };
};

export const handlePrismaClientValidationError = (): ISimplifiedError => ({
    statusCode: status.BAD_REQUEST,
    message: "Invalid data sent to database",
    errorSource: [{ path: "", message: "Invalid data sent to database" }],
});

export const handlePrismaClientInitializationError = (): ISimplifiedError => ({
    statusCode: status.INTERNAL_SERVER_ERROR,
    message: "Failed to connect to database",
    errorSource: [{ path: "", message: "Failed to connect to database" }],
});

export const handlePrismaClientRustPanicError = (): ISimplifiedError => ({
    statusCode: status.INTERNAL_SERVER_ERROR,
    message: "Database engine crashed",
    errorSource: [{ path: "", message: "Database engine crashed" }],
});
