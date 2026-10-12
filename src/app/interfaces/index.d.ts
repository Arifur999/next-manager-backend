import { IRequestUser } from "./requestUser.interface.js";

declare global {
    namespace Express {
        interface Request {
            user?: IRequestUser;
            /** Set by requestLogger; echoed in x-request-id and in error bodies. */
            id?: string;
        }
    }
}

export {};
