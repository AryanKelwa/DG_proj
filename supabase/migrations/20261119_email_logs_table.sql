-- ==============================================================================
-- DIGITAL HEROES / W2P PLATFORM - EMAIL LOGS SCHEMA & MIGRATION
-- (PRD § 13: Transactional Server Email Notifications & Exact-Once Guarantees)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.email_logs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  event TEXT NOT NULL, -- 'order_confirmed', 'proof_ready', 'change_requested', 'proof_approved', 'pipeline_status_changed', 'order_completed'
  recipient TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT 'Valued Customer',
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL, -- 'sent', 'failed', 'skipped_duplicate'
  provider TEXT NOT NULL, -- 'resend', 'mailpit', 'test_capture'
  provider_message_id TEXT,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup indexes
CREATE INDEX IF NOT EXISTS idx_email_logs_order_id ON public.email_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON public.email_logs(recipient);
CREATE INDEX IF NOT EXISTS idx_email_logs_event ON public.email_logs(event);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON public.email_logs(created_at DESC);

-- Enable RLS
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Customers can view only logs addressed to their verified account email
CREATE POLICY "Customers can view only own email logs"
  ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (
    recipient = auth.jwt()->>'email'
    OR
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Service role and server route handlers can insert logs
CREATE POLICY "Server can insert email logs"
  ON public.email_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
