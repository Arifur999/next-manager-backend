import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AccountController } from "./account.controller.js";
import { createAccountZodSchema, updateAccountZodSchema } from "./account.validation.js";

const router = Router();

// Balances are money-sensitive, and money is the admin's remit alone.
// Nobody in sales, delivery or operations has a reason to see what the
// agency is holding.
router.get("/", checkAuth(Role.admin), AccountController.getAllAccounts);
router.get("/summary", checkAuth(Role.admin), AccountController.getBalanceSummary);
router.post("/", checkAuth(Role.admin), validateRequest(createAccountZodSchema), AccountController.createAccount);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateAccountZodSchema), AccountController.updateAccount);
router.delete("/:id", checkAuth(Role.admin), AccountController.deleteAccount);

export const AccountRoutes = router;
