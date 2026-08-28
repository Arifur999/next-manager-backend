import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { OwnerWithdrawalController } from "./ownerWithdrawal.controller.js";
import { createOwnerWithdrawalZodSchema, updateOwnerWithdrawalZodSchema } from "./ownerWithdrawal.validation.js";

const router = Router();

// Admin only, every route including the read. With owner gone, admin is the
// top of a company and this is what they take out of it - nobody below them
// has any business seeing it, and the role gate is the only thing enforcing
// that.
router.get("/", checkAuth(Role.admin), OwnerWithdrawalController.getAllWithdrawals);
router.post("/", checkAuth(Role.admin), validateRequest(createOwnerWithdrawalZodSchema), OwnerWithdrawalController.createWithdrawal);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateOwnerWithdrawalZodSchema), OwnerWithdrawalController.updateWithdrawal);
router.delete("/:id", checkAuth(Role.admin), OwnerWithdrawalController.deleteWithdrawal);

export const OwnerWithdrawalRoutes = router;
