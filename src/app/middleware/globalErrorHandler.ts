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

// Expected auth rejections (not-logged-in visitors hitting /me, expired tokens)
// are routine - log them as one line instead of a full stack trace, or real
// errors get buried under them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isExpectedAuthError = (err: any) =>
    err instanceof AppError && (err.statusCode === status.UNAUTHORIZED || err.statusCode === status.FORBIDDEN);

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export const globalErrorHandler = async (err: any, req: Request, res: Response, next: NextFunction) => {
    if (env.NODE_ENV === "development") {
        if (isExpectedAuthError(err)) {
            console.log(`[auth] ${req.method} ${req.originalUrl} -> ${err.statusCode}: ${err.message}`);
        } else {
            console.log("Error from Global Error Handler:", err);
        }
    }

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
    } else if (err instanceof Error) {
        statusCode = status.INTERNAL_SERVER_ERROR;
        message = err.message;
        stack = err.stack;
        errorSource = [{ path: "", message: err.message }];
    }

    const errorResponse: IErrorResponse = {
        success: false,
        message,
        errorSource,
        error: env.NODE_ENV === "development" ? err : undefined,
        stack: env.NODE_ENV === "development" ? stack : undefined,
    };

    res.status(statusCode).json(errorResponse);
};
