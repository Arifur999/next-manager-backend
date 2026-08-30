-- Attendance, leave and payroll.
--
-- One rule shapes the whole thing: payroll does not record money of its own.
-- Completing a run creates one team_payout per line, through the same path a
-- manual payout takes, so salary is recorded in exactly one place and the books
-- cannot disagree with themselves. payroll_items.payout_id is the link, and its
-- being null is what "not paid yet" means - there is no second flag to drift.

CREATE TYPE "AttendanceSource" AS ENUM ('self', 'admin');
CREATE TYPE "LeaveStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE "PayrollStatus" AS ENUM ('draft', 'completed');

-- Being at work, which is not the same as logging hours. A person can be
-- present all day and log nothing against a task, and somebody can log four
-- hours on a day they never came in.
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "check_in" TIMESTAMP(3),
    -- Null while somebody is still in. A normal state during the day, not
    -- missing data.
    "check_out" TIMESTAMP(3),
    "source" "AttendanceSource" NOT NULL DEFAULT 'self',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- One day, one row: a second check-in is a correction, not another day.
CREATE UNIQUE INDEX "attendance_user_id_date_key" ON "attendance"("user_id", "date");
CREATE INDEX "attendance_organization_id_date_idx" ON "attendance"("organization_id", "date" DESC);
CREATE INDEX "attendance_user_id_idx" ON "attendance"("user_id");

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- The allowance. Zero means tracked but not capped - unpaid leave usually
    -- works that way, and a zero allowance that refused every request would be
    -- worse than no feature.
    "days_per_year" INTEGER NOT NULL DEFAULT 0,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_types_organization_id_name_key" ON "leave_types"("organization_id", "name");
CREATE INDEX "leave_types_organization_id_idx" ON "leave_types"("organization_id");

ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    -- Stored, not derived from the dates: what counts as a working day is an
    -- agency's own business, and recomputing it later would silently restate
    -- leave already approved.
    "days" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "LeaveStatus" NOT NULL DEFAULT 'pending',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_requests_organization_id_status_idx" ON "leave_requests"("organization_id", "status");
CREATE INDEX "leave_requests_user_id_from_date_idx" ON "leave_requests"("user_id", "from_date" DESC);
CREATE INDEX "leave_requests_leave_type_id_idx" ON "leave_requests"("leave_type_id");

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: a leave type with history cannot be deleted, only switched off.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey"
    FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'draft',
    -- Chosen at completion, because that is when the money actually moves.
    "account_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- One run per month per agency. Two runs for September is a mistake, not a
-- workflow - and it is the cheapest possible guard against paying twice.
CREATE UNIQUE INDEX "payroll_runs_organization_id_period_start_key"
    ON "payroll_runs"("organization_id", "period_start");
CREATE INDEX "payroll_runs_organization_id_period_start_idx"
    ON "payroll_runs"("organization_id", "period_start" DESC);
CREATE INDEX "payroll_runs_account_id_idx" ON "payroll_runs"("account_id");

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gross_bdt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deductions_bdt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    -- Stored, like an invoice line stores its amount: what somebody was
    -- actually paid is a fact about that month, and a formula change must not
    -- restate it.
    "net_bdt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    -- The payout this line produced. Null means not paid yet - which is how
    -- that question is answered, rather than by a second flag that could drift.
    "payout_id" TEXT,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_items_payout_id_key" ON "payroll_items"("payout_id");
CREATE UNIQUE INDEX "payroll_items_run_id_user_id_key" ON "payroll_items"("run_id", "user_id");
CREATE INDEX "payroll_items_run_id_idx" ON "payroll_items"("run_id");
CREATE INDEX "payroll_items_user_id_idx" ON "payroll_items"("user_id");

ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payout_id_fkey"
    FOREIGN KEY ("payout_id") REFERENCES "team_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
