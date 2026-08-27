import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreateExpenseCategoryPayload,
    IUpdateExpenseCategoryPayload,
} from "./expenseCategory.validation.js";

const getAllCategories = async (user: IRequestUser) => {
    return prisma.expenseCategory.findMany({
        where: { organization_id: user.organizationId },
        orderBy: [{ type: "asc" }, { name: "asc" }],
    });
};

const createCategory = async (payload: ICreateExpenseCategoryPayload, user: IRequestUser) => {
    const duplicate = await prisma.expenseCategory.findFirst({
        where: { organization_id: user.organizationId, name: payload.name },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, "A category with this name already exists");
    }

    return prisma.expenseCategory.create({
        data: { ...payload, organization_id: user.organizationId },
    });
};

const updateCategory = async (
    id: string,
    payload: IUpdateExpenseCategoryPayload,
    user: IRequestUser
) => {
    const existing = await prisma.expenseCategory.findFirst({
        where: { id, organization_id: user.organizationId },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Expense category not found");
    }

    return prisma.expenseCategory.update({ where: { id }, data: payload });
};

const deleteCategory = async (id: string, user: IRequestUser) => {
    const existing = await prisma.expenseCategory.findFirst({
        where: { id, organization_id: user.organizationId },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Expense category not found");
    }

    // Expenses point at the category with a Restrict FK, and reassigning them
    // silently would move money between report lines. Deactivating keeps the
    // history intact and takes it out of the picker.
    const expenseCount = await prisma.expense.count({
        where: { category_id: id, organization_id: user.organizationId, deleted_at: null },
    });

    if (expenseCount > 0) {
        throw new AppError(
            status.CONFLICT,
            "This category has expenses recorded against it. Deactivate it instead."
        );
    }

    await prisma.expenseCategory.delete({ where: { id } });

    return { message: "Expense category deleted successfully" };
};

export const ExpenseCategoryService = {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
};
