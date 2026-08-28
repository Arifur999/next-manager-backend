import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExpenseController } from "./expense.controller.js";
import { createExpenseZodSchema, updateExpenseZodSchema } from "./expense.validation.js";

const router = Router();

router.get("/", checkAuth(Role.admin), ExpenseController.getAllExpenses);
router.get("/breakdown", checkAuth(Role.admin), ExpenseController.getCategoryBreakdown);
router.post("/", checkAuth(Role.admin), validateRequest(createExpenseZodSchema), ExpenseController.createExpense);
router.patch("/:id", checkAuth(Role.admin), validateRequest(updateExpenseZodSchema), ExpenseController.updateExpense);
router.delete("/:id", checkAuth(Role.admin), ExpenseController.deleteExpense);

export const ExpenseRoutes = router;
