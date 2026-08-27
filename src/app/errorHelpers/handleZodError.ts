import status from "http-status";
import z from "zod";
import { IError, ISimplifiedError } from "../interfaces/error.interfaces.js";

export const handleZodError = (error: z.ZodError): ISimplifiedError => {
    const errorSource: IError[] = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
    }));

    return {
        statusCode: status.BAD_REQUEST,
        message: "Validation failed",
        errorSource,
    };
};
