import z from "zod";
import { ExpenseCategoryType } from "../../../generated/prisma/enums.js";

export const createExpenseCategoryZodSchema = z.object({
    name: z.string("Name must be string").min(1, "Name is required"),
    // "employee" marks salary-like costs so operating-expense reporting can
    // exclude them and P&L does not double-count what team payouts already show.
    type: z.enum(ExpenseCategoryType, "Choose a valid category type").optional(),
    color: z.string("Color must be string").optional(),
    monthly_budget: z.number("Monthly budget must be a number").nonnegative().optional(),
    is_active: z.boolean("is_active must be a boolean").optional(),
});

export const updateExpenseCategoryZodSchema = createExpenseCategoryZodSchema.partial();

export type ICreateExpenseCategoryPayload = z.infer<typeof createExpenseCategoryZodSchema>;
export type IUpdateExpenseCategoryPayload = z.infer<typeof updateExpenseCategoryZodSchema>;
