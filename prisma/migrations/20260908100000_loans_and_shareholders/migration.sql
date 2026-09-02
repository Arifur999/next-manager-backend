-- Borrowing, and the people who own the agency.
--
-- Three new ledger sources. None of them is revenue or cost: borrowed money
-- arriving is a liability, an instalment going out is partly settling that
-- liability and partly interest, and a distribution is profit handed to an
-- owner. All three move a real account, which is why they are ledger sources at
-- all - money that leaves the business invisibly is what a set of books cannot
-- survive.
ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'loan_received';
ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'loan_repayment';
ALTER TYPE "LedgerSource" ADD VALUE IF NOT EXISTS 'shareholder_distribution';

CREATE TYPE "LoanStatus" AS ENUM ('active', 'settled', 'closed');

CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "principal_bdt" DECIMAL(15,2) NOT NULL,
    -- Annual rate as a percentage, for reference. The instalments carry the
    -- split that is actually repaid.
    "interest_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "started_on" DATE NOT NULL,
    "term_months" INTEGER NOT NULL,
    -- Nullable: a loan already part repaid when it is first entered never
    -- landed in an account here.
    "account_id" TEXT,
    "status" "LoanStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT NOT NULL DEFAULT '',
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loans_organization_id_idx" ON "loans"("organization_id");
CREATE INDEX "loans_organization_id_status_idx" ON "loans"("organization_id", "status");
CREATE INDEX "loans_account_id_idx" ON "loans"("account_id");

ALTER TABLE "loans" ADD CONSTRAINT "loans_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The principal/interest split is the point of this table. Repaying principal
-- settles a liability and is not a cost; the interest is. One lump column would
-- understate profit by the principal every single month.
CREATE TABLE "loan_instalments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "principal_bdt" DECIMAL(15,2) NOT NULL,
    "interest_bdt" DECIMAL(15,2) NOT NULL DEFAULT 0,
    -- Null means unpaid. This IS the paid flag; there is no second boolean that
    -- could disagree with it.
    "paid_at" TIMESTAMP(3),
    "paid_from_account_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_instalments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "loan_instalments_loan_id_seq_key" ON "loan_instalments"("loan_id", "seq");
CREATE INDEX "loan_instalments_organization_id_idx" ON "loan_instalments"("organization_id");
CREATE INDEX "loan_instalments_loan_id_idx" ON "loan_instalments"("loan_id");
-- What is due next, across every loan.
CREATE INDEX "loan_instalments_organization_id_paid_at_due_date_idx" ON "loan_instalments"("organization_id", "paid_at", "due_date");
CREATE INDEX "loan_instalments_paid_from_account_id_idx" ON "loan_instalments"("paid_from_account_id");

ALTER TABLE "loan_instalments" ADD CONSTRAINT "loan_instalments_loan_id_fkey"
    FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_instalments" ADD CONSTRAINT "loan_instalments_paid_from_account_id_fkey"
    FOREIGN KEY ("paid_from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- user_id is nullable on purpose: an investor who owns part of the business but
-- never signs in is a normal arrangement, and requiring an account would mean
-- creating logins nobody uses.
CREATE TABLE "shareholders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "share_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shareholders_organization_id_name_key" ON "shareholders"("organization_id", "name");
CREATE INDEX "shareholders_organization_id_idx" ON "shareholders"("organization_id");
CREATE INDEX "shareholders_user_id_idx" ON "shareholders"("user_id");

ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "shareholder_distributions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "shareholder_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount_bdt" DECIMAL(15,2) NOT NULL,
    "account_id" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholder_distributions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shareholder_distributions_organization_id_idx" ON "shareholder_distributions"("organization_id");
CREATE INDEX "shareholder_distributions_organization_id_date_idx" ON "shareholder_distributions"("organization_id", "date" DESC);
CREATE INDEX "shareholder_distributions_shareholder_id_idx" ON "shareholder_distributions"("shareholder_id");
CREATE INDEX "shareholder_distributions_account_id_idx" ON "shareholder_distributions"("account_id");

ALTER TABLE "shareholder_distributions" ADD CONSTRAINT "shareholder_distributions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shareholder_distributions" ADD CONSTRAINT "shareholder_distributions_shareholder_id_fkey"
    FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shareholder_distributions" ADD CONSTRAINT "shareholder_distributions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
