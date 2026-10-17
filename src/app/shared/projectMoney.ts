import { Role } from "../../generated/prisma/enums.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

/**
 * What a project is worth is not operations' to know: they deliver the work,
 * and the contract and baseline values are the deal. Passed as Prisma's `omit`
 * on every read that returns whole project rows, so for them the figures never
 * leave the database.
 */
const PROJECT_MONEY = { contract_value_usd: true, baseline_value_usd: true } as const;

export const projectMoneyOmit = (user: Pick<IRequestUser, "role">) =>
    user.role === Role.operations ? PROJECT_MONEY : undefined;
