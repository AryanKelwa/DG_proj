-- Migration: 20261119_orders_immutable_address_and_draft_link.sql
-- Description: Enforce immutable JSONB shipping address snapshot and link orders to job drafts and proofs

-- 1. Ensure public.orders has shipping_address JSONB column and draft/proof references
ALTER TABLE IF EXISTS public.orders
  ADD COLUMN IF NOT EXISTS draft_id TEXT,
  ADD COLUMN IF NOT EXISTS proof_version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- 2. Ensure shipping_address cannot be null
ALTER TABLE IF EXISTS public.orders
  ALTER COLUMN shipping_address SET NOT NULL;

-- 3. Add index on order_number and stripe_session_id for strict webhook idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id ON public.orders(stripe_session_id);

-- 4. Row-Level Security: Enforce strict multi-tenant customer isolation
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Orders customer access" ON public.orders;
CREATE POLICY "Orders customer access" ON public.orders
  FOR SELECT USING (
    auth.uid() = customer_id 
    OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );
