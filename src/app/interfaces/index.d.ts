import { IRequestUser } from "./requestUser.interface.js";

declare global {
    namespace Express {
        interface Request {
            user?: IRequestUser;
        }
    }
}

export {};
