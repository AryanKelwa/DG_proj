-- ==============================================================================
-- DIGITAL HEROES / W2P PLATFORM - PHASE H ADMIN CONSOLE MIGRATION
-- (PRD § 03, § 11, § 13, § 14, § 15, § 16)
-- ==============================================================================

-- 1. ADMIN AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL, -- 'pipeline_stage_change', 'production_file_download', 'user_role_change', 'user_status_change', 'product_template_edit', 'order_archive'
  target_type TEXT NOT NULL, -- 'order', 'user', 'product'
  target_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast audit queries
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON public.admin_audit_logs(action);

-- Enable RLS on audit logs
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Only admins can insert audit logs
CREATE POLICY "Admins can insert audit logs"
  ON public.admin_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 2. HARDENED ROW-LEVEL SECURITY POLICIES ON ORDERS TABLE
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Drop prior overlapping policies if they exist
DROP POLICY IF EXISTS "Customers view own orders" ON public.orders;
DROP POLICY IF EXISTS "Admins view all orders" ON public.orders;

-- Customer policy: Customers view strictly their own orders
CREATE POLICY "Customers view own orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
  );

-- Admin policy: Admins view all orders across all accounts
CREATE POLICY "Admins view all orders"
  ON public.orders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 3. ORDERS INDEXES FOR REPORTING & FAST SEARCH
CREATE INDEX IF NOT EXISTS idx_orders_pipeline_stage ON public.orders(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
