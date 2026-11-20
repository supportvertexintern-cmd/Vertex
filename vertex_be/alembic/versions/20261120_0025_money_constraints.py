"""money the database itself refuses (upstream staging's money-constraints.sql, 2026-11-13)

The app computes every commission and fee amount on the server; a second
path (a script, a future route, a manual fix) mustn't be able to store
nonsense either (upstream's QA SEC-DB-010):

1. No negative amount: PartnerCommission, AdminFee, ReferralCommission.
2. A monthly row's period is a real month, "YYYY-MM".
3. A deployed candidate earns the partner six monthly commissions, no more
   (DEPLOYMENT_COMMISSION_MONTHS in app/services/partner_commissions.py;
   change both together). The trigger runs AFTER INSERT, so a repeat of an
   existing month fails on the unique key first (the engine's harmless lost
   race), and only a genuinely new seventh row reaches the count. Only live
   rows count: a soft-deleted one stays in the table.

The checks are NOT VALID: every new or changed row is checked from now on,
and rows already stored are left alone, so this can't fail on old data.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MONTH = "'^[0-9]{4}-(0[1-9]|1[0-2])$'"
CHECKS = (
    ("PartnerCommission", "partner_commission_amount_not_negative", "amount >= 0"),
    ("AdminFee", "admin_fee_amount_not_negative", "amount >= 0"),
    ("ReferralCommission", "referral_commission_amount_not_negative", "amount >= 0"),
    ("PartnerCommission", "partner_commission_period_is_a_month", f"rule_type::text <> 'monthly_deployment' OR period ~ {MONTH}"),
    ("AdminFee", "admin_fee_period_is_a_month", f"fee_type::text <> 'deployment_monthly' OR period ~ {MONTH}"),
)


def upgrade() -> None:
    for table, name, check in CHECKS:
        op.execute(f'ALTER TABLE "{table}" ADD CONSTRAINT {name} CHECK ({check}) NOT VALID')
    op.execute(
        """
        CREATE FUNCTION reject_extra_deployment_commission() RETURNS trigger AS $$
        BEGIN
          IF NEW.rule_type::text = 'monthly_deployment' AND (
            SELECT count(*) FROM "PartnerCommission"
            WHERE partner_id = NEW.partner_id AND candidate_id = NEW.candidate_id
              AND rule_type::text = 'monthly_deployment' AND deleted_at IS NULL
          ) > 6 THEN
            RAISE EXCEPTION 'A candidate earns at most 6 monthly deployment commissions';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        'CREATE TRIGGER partner_commission_six_months AFTER INSERT ON "PartnerCommission" '
        "FOR EACH ROW EXECUTE FUNCTION reject_extra_deployment_commission()"
    )


def downgrade() -> None:
    op.execute('DROP TRIGGER IF EXISTS partner_commission_six_months ON "PartnerCommission"')
    op.execute("DROP FUNCTION IF EXISTS reject_extra_deployment_commission()")
    for table, name, _check in reversed(CHECKS):
        op.execute(f'ALTER TABLE "{table}" DROP CONSTRAINT IF EXISTS {name}')
