import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireCompany } from "../../middleware/requireCompany.js";
import { TransactionController } from "./transaction.controller.js";

const router = Router();

// The ledger is every figure the agency holds, so it carries the same rule as
// account balances: admin alone. Nobody in sales, delivery or operations has a
// reason to read what the business is sitting on.
//
// GET only, and it will stay that way. Rows are written by the thing that
// caused them - a payment, an expense, an exchange - and a ledger somebody can
// type into directly is one that can be made to disagree with the records it is
// supposed to summarise.
router.get("/", checkAuth(Role.admin), requireCompany, TransactionController.getTransactions);

export const TransactionRoutes = router;
