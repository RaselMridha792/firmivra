/** Proposed table contract, installed only in isolated synthetic tests, not a migration. */
export const notificationSchema = [
  `CREATE TABLE IF NOT EXISTS notifications (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),recipient_user_id uuid NOT NULL REFERENCES users(id),category text NOT NULL,title text NOT NULL,message text NOT NULL,target_entity_type text,target_entity_id uuid,event_key text NOT NULL,in_app boolean NOT NULL DEFAULT true,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,recipient_user_id,event_key))`,
  `CREATE INDEX IF NOT EXISTS notifications_recipient_page ON notifications (business_id,recipient_user_id,created_at DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_preferences (business_id uuid NOT NULL REFERENCES businesses(id),user_id uuid NOT NULL REFERENCES users(id),category text NOT NULL,in_app boolean NOT NULL,email boolean NOT NULL,sms boolean NOT NULL,PRIMARY KEY(business_id,user_id,category))`,
  ...['notifications', 'notification_preferences'].flatMap((table) => [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS fixture_firm ON ${table}`,
    `CREATE POLICY fixture_firm ON ${table} USING (app_scope()='business' AND business_id=app_current_business_id()) WITH CHECK (app_scope()='business' AND business_id=app_current_business_id())`,
    `GRANT SELECT,INSERT,UPDATE ON ${table} TO firmivra_app`,
    `REVOKE DELETE ON ${table} FROM firmivra_app`,
  ]),
];
