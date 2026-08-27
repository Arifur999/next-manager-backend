import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AccountController } from "./account.controller.js";
import { createAccountZodSchema, updateAccountZodSchema } from "./account.validation.js";

const router = Router();

// Balances are money-sensitive: a member has no reason to see what the agency
// holds, so the whole module stops at manager.
router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), AccountController.getAllAccounts);
router.get("/summary", checkAuth(Role.owner, Role.admin, Role.manager), AccountController.getBalanceSummary);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createAccountZodSchema), AccountController.createAccount);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updateAccountZodSchema), AccountController.updateAccount);
router.delete("/:id", checkAuth(Role.owner), AccountController.deleteAccount);

export const AccountRoutes = router;
