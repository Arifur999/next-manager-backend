import { Request } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/** The signed-in user, put there by checkAuth. A 401 if a route forgot checkAuth. */
export const requireUser = (req: Request): IRequestUser => {
    if (!req.user) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No user on the request.");
    }
    return req.user;
};
