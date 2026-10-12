import { NextFunction, Request, Response } from "express";
import status from "http-status";
import z from "zod";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";
import {
    handlePrismaClientInitializationError,
    handlePrismaClientKnownRequestError,
    handlePrismaClientRustPanicError,
    handlePrismaClientUnknownError,
    handlePrismaClientValidationError,
} from "../errorHelpers/handlePrismaErrors.js";
import { handleZodError } from "../errorHelpers/handleZodError.js";
import { IError, IErrorResponse } from "../interfaces/error.interfaces.js";
import { logger } from "../lib/logger.js";

// express.json() rejects with a 4xx `status` and a string `type` such as
// entity.parse.failed or entity.too.large.
const isBodyParserError = (err: unknown): err is Error & { status: number; type: string } => {
    if (!(err instanceof Error)) return false;
    const candidate = err as Error & { status?: unknown; type?: unknown };
    return (
        typeof candidate.status === "number" &&
        candidate.status >= 400 &&
        candidate.status < 500 &&
        typeof candidate.type === "string"
    );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export const globalErrorHandler = async (err: any, req: Request, res: Response, next: NextFunction) => {
    let errorSource: IError[] = [];
    let statusCode: number = status.INTERNAL_SERVER_ERROR;
    let message = "Internal Server Error";
    let stack: string | undefined = undefined;

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const simplifiedError = handlePrismaClientKnownRequestError(err);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
        const simplifiedError = handlePrismaClientUnknownError(err);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof Prisma.PrismaClientValidationError) {
        const simplifiedError = handlePrismaClientValidationError();
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof Prisma.PrismaClientInitializationError) {
        const simplifiedError = handlePrismaClientInitializationError();
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof Prisma.PrismaClientRustPanicError) {
        const simplifiedError = handlePrismaClientRustPanicError();
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof z.ZodError) {
        const simplifiedError = handleZodError(err);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorSource = [...simplifiedError.errorSource];
        stack = err.stack;
    } else if (err instanceof AppError) {
        statusCode = err.statusCode;
        message = err.message;
        stack = err.stack;
        errorSource = [{ path: "", message: err.message }];
    } else if (isBodyParserError(err)) {
        statusCode = err.status;
        message = err.status === status.REQUEST_ENTITY_TOO_LARGE ? "Request body is too large" : "Request body is not valid JSON";
        errorSource = [{ path: "body", message }];
    } else if (err instanceof Error) {
        // An unexpected error's text can describe internals; production gets the fixed sentence.
        statusCode = status.INTERNAL_SERVER_ERROR;
        message = env.NODE_ENV === "production" ? "Internal Server Error" : err.message;
        stack = err.stack;
        errorSource = [{ path: "", message }];
    }

    // 5xx is always logged, so a production failure leaves a trace. 4xx is
    // routine and only logged while developing. Path only: a query string can
    // carry a search term or a token.
    const fields = { requestId: req.id, method: req.method, path: req.path, status: statusCode, error: err };
    if (statusCode >= 500) {
        logger.error("Request failed", fields);
    } else if (env.NODE_ENV === "development") {
        logger.warn("Request rejected", { requestId: req.id, method: req.method, path: req.path, status: statusCode, reason: message });
    }

    const errorResponse: IErrorResponse = {
        success: false,
        message,
        errorSource,
        requestId: req.id,
        error: env.NODE_ENV === "development" ? err : undefined,
        stack: env.NODE_ENV === "development" ? stack : undefined,
    };

    res.status(statusCode).json(errorResponse);
};
