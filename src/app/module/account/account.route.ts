import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireScope } from "../../middleware/requireScope.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AccountController } from "./account.controller.js";
import { createAccountZodSchema, updateAccountZodSchema } from "./account.validation.js";
import { idParams } from "../../shared/requestSchemas.js";

const router = Router();

// Balances are money-sensitive, and money is the admin's remit alone.
// Nobody in sales, delivery or operations has a reason to see what the
// agency is holding. The squares narrow a co-admin who does not handle money;
// an account has no owner, so any scope but "none" reaches all of them.
router.get("/", checkAuth(Role.admin), requireScope("accounts", "view"), AccountController.getAllAccounts);
router.get("/summary", checkAuth(Role.admin), requireScope("accounts", "view"), AccountController.getBalanceSummary);
router.post("/", checkAuth(Role.admin), requireScope("accounts", "create"), validateRequest(createAccountZodSchema), AccountController.createAccount);
router.patch("/:id", checkAuth(Role.admin), requireScope("accounts", "edit"), validateRequest({ params: idParams, body: updateAccountZodSchema }), AccountController.updateAccount);
router.delete("/:id", checkAuth(Role.admin), validateRequest({ params: idParams }), AccountController.deleteAccount);

export const AccountRoutes = router;
