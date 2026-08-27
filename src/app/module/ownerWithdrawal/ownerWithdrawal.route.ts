import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { OwnerWithdrawalController } from "./ownerWithdrawal.controller.js";
import { createOwnerWithdrawalZodSchema, updateOwnerWithdrawalZodSchema } from "./ownerWithdrawal.validation.js";

const router = Router();

// Owner only, every route including the read. This is the one part of the
// system an admin must not see - what the owner takes out is nobody else's
// business, and the role gate is the only thing enforcing that.
router.get("/", checkAuth(Role.owner), OwnerWithdrawalController.getAllWithdrawals);
router.post("/", checkAuth(Role.owner), validateRequest(createOwnerWithdrawalZodSchema), OwnerWithdrawalController.createWithdrawal);
router.patch("/:id", checkAuth(Role.owner), validateRequest(updateOwnerWithdrawalZodSchema), OwnerWithdrawalController.updateWithdrawal);
router.delete("/:id", checkAuth(Role.owner), OwnerWithdrawalController.deleteWithdrawal);

export const OwnerWithdrawalRoutes = router;
