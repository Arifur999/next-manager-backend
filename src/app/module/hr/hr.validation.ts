import z from "zod";

// ---------------------------------------------------------------- attendance

export const recordAttendanceZodSchema = z.object({
    user_id: z.uuid("user_id must be a valid id"),
    date: z.iso.date("Date must be YYYY-MM-DD"),
    // HH:MM on that date. Absent means "not recorded", which is different from
    // midnight and has to stay different.
    check_in: z
        .string("Check-in must be HH:MM")
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Check-in must be HH:MM")
        .optional(),
    check_out: z
        .string("Check-out must be HH:MM")
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Check-out must be HH:MM")
        .optional(),
    notes: z.string("Notes must be a string").max(200).optional(),
});

export type IRecordAttendancePayload = z.infer<typeof recordAttendanceZodSchema>;

// ---------------------------------------------------------------- leave

export const createLeaveTypeZodSchema = z.object({
    name: z.string("Name must be a string").min(1, "Give it a name").max(60),
    // Zero means tracked but not capped. A zero allowance that refused every
    // request would be worse than not having the feature.
    days_per_year: z
        .number("Days must be a number")
        .int()
        .min(0, "An allowance cannot be negative")
        .max(365, "That is more days than a year has")
        .optional(),
    is_paid: z.boolean("is_paid must be true or false").optional(),
});

export const updateLeaveTypeZodSchema = createLeaveTypeZodSchema
    .partial()
    .extend({ is_active: z.boolean("is_active must be true or false").optional() });

export const requestLeaveZodSchema = z.object({
    leave_type_id: z.uuid("leave_type_id must be a valid id"),
    from_date: z.iso.date("From date must be YYYY-MM-DD"),
    to_date: z.iso.date("To date must be YYYY-MM-DD"),
    // Sent rather than derived: half days are real, and what counts as a
    // working day is the agency's own business.
    days: z
        .number("Days must be a number")
        .positive("Leave of zero days is not leave")
        .max(365, "That is more days than a year has"),
    reason: z.string("Reason must be a string").max(300).optional(),
});

export const decideLeaveZodSchema = z.object({
    approve: z.boolean("Say whether it is approved"),
    note: z.string("Note must be a string").max(300).optional(),
});

export type ICreateLeaveTypePayload = z.infer<typeof createLeaveTypeZodSchema>;
export type IUpdateLeaveTypePayload = z.infer<typeof updateLeaveTypeZodSchema>;
export type IRequestLeavePayload = z.infer<typeof requestLeaveZodSchema>;
export type IDecideLeavePayload = z.infer<typeof decideLeaveZodSchema>;

// ---------------------------------------------------------------- payroll

export const createPayrollRunZodSchema = z.object({
    period_start: z.iso.date("Period start must be YYYY-MM-DD"),
    period_end: z.iso.date("Period end must be YYYY-MM-DD"),
    notes: z.string("Notes must be a string").max(300).optional(),
});

export const setPayrollItemsZodSchema = z.object({
    items: z
        .array(
            z.object({
                id: z.uuid("id must be a valid id"),
                gross_bdt: z
                    .number("Gross must be a number")
                    .nonnegative("A wage cannot be negative")
                    .optional(),
                deductions_bdt: z
                    .number("Deductions must be a number")
                    .nonnegative("Deductions cannot be negative")
                    .optional(),
                notes: z.string("Notes must be a string").max(200).optional(),
            })
        )
        .min(1, "Nothing to save"),
});

export const completePayrollZodSchema = z.object({
    // Chosen here rather than when the run was opened, because this is the
    // moment the money actually moves.
    account_id: z.uuid("Choose the account the salaries are paid from"),
});

export type ICreatePayrollRunPayload = z.infer<typeof createPayrollRunZodSchema>;
export type ISetPayrollItemsPayload = z.infer<typeof setPayrollItemsZodSchema>;
export type ICompletePayrollPayload = z.infer<typeof completePayrollZodSchema>;
