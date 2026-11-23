-- SA-SUB-R3: let platform scope see due trials and their EXPIRED update results,
-- and let the expiry job transition only due trials to EXPIRED.
CREATE POLICY platform_firm_subscriptions_trial_expiry_read
  ON platform_firm_subscriptions FOR SELECT
  USING (
    app_scope() = 'platform'
    AND status IN ('TRIAL', 'EXPIRED')
    AND trial_ends_at <= CURRENT_TIMESTAMP
  );

CREATE POLICY platform_firm_subscriptions_trial_expiry_update
  ON platform_firm_subscriptions FOR UPDATE
  USING (
    app_scope() = 'platform'
    AND status = 'TRIAL'
    AND trial_ends_at <= CURRENT_TIMESTAMP
  )
  WITH CHECK (
    app_scope() = 'platform'
    AND status = 'EXPIRED'
  );
