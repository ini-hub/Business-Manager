-- 0031_trial_reminders.sql
--
-- Dedupe log for TrialReminderService: one row per (organisation, stage) so
-- the hourly poller never emails the same "trial ends in N days" reminder
-- twice for the same org, following the same log-table dedupe pattern as
-- reminder_logs (credit reminders).

CREATE TABLE IF NOT EXISTS trial_reminder_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL REFERENCES organisations(id),
  stage TEXT NOT NULL, -- '3_days' | '2_days' | 'today'
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_reminder_logs_org_stage
  ON trial_reminder_logs(organisation_id, stage);
