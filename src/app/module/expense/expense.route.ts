import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExpenseController } from "./expense.controller.js";
import { createExpenseZodSchema, updateExpenseZodSchema } from "./expense.validation.js";

const router = Router();

router.get("/", checkAuth(Role.owner, Role.admin, Role.manager), ExpenseController.getAllExpenses);
router.get("/breakdown", checkAuth(Role.owner, Role.admin, Role.manager), ExpenseController.getCategoryBreakdown);
router.post("/", checkAuth(Role.owner, Role.admin), validateRequest(createExpenseZodSchema), ExpenseController.createExpense);
router.patch("/:id", checkAuth(Role.owner, Role.admin), validateRequest(updateExpenseZodSchema), ExpenseController.updateExpense);
router.delete("/:id", checkAuth(Role.owner), ExpenseController.deleteExpense);

export const ExpenseRoutes = router;
