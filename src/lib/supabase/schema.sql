-- ==============================================================================
-- W2P WEB-TO-PRINT PLATFORM
-- PRODUCTION DATABASE SCHEMA & INITIAL SEED
-- ==============================================================================

-- 1. EXTENSIONS & ENUMS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM ('visitor', 'customer', 'admin');
CREATE TYPE pipeline_stage AS ENUM ('QUOTE', 'ORDER', 'ARTWORK', 'PROOF', 'PRODUCTION', 'COMPLETED');
CREATE TYPE proof_status AS ENUM ('pending_review', 'approved', 'changes_requested');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- 2. PROFILES (Extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'customer',
  company_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. DIVISIONS (The 6 core manufacturing divisions)
CREATE TABLE IF NOT EXISTS public.divisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PRODUCTS (Parameter-driven dynamic configuration)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID REFERENCES public.divisions(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT NOT NULL,
  base_price_cents INT NOT NULL DEFAULT 200,
  price_per_sq_cm_cents INT NOT NULL DEFAULT 5,
  min_width_mm INT NOT NULL DEFAULT 20,
  max_width_mm INT NOT NULL DEFAULT 1200,
  min_height_mm INT NOT NULL DEFAULT 20,
  max_height_mm INT NOT NULL DEFAULT 1200,
  default_width_mm INT NOT NULL DEFAULT 75,
  default_height_mm INT NOT NULL DEFAULT 75,
  default_bleed_mm NUMERIC(4,2) NOT NULL DEFAULT 3.00,
  default_safety_margin_mm NUMERIC(4,2) NOT NULL DEFAULT 3.00,
  allowed_materials JSONB NOT NULL DEFAULT '[]',
  allowed_orientations JSONB NOT NULL DEFAULT '["portrait", "landscape", "square"]',
  has_variable_data BOOLEAN DEFAULT FALSE,
  variable_data_sample_headers JSONB,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PRICING TIERS (Volume discounts)
CREATE TABLE IF NOT EXISTS public.pricing_tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  min_quantity INT NOT NULL,
  discount_percentage NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ORDERS (Xero-ready structure)
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  pipeline_stage pipeline_stage NOT NULL DEFAULT 'ORDER',
  payment_status payment_status NOT NULL DEFAULT 'paid',
  subtotal_cents INT NOT NULL,
  tax_cents INT NOT NULL,
  total_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  shipping_address JSONB NOT NULL,
  xero_invoice_data JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  division_slug TEXT NOT NULL,
  width_mm INT NOT NULL,
  height_mm INT NOT NULL,
  material TEXT NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  total_price_cents INT NOT NULL,
  artwork_type TEXT NOT NULL, -- 'in_browser_designer' OR 'direct_upload'
  canvas_json JSONB,
  uploaded_file_url TEXT,
  preview_thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PROOFS (Versioned proofs & approval gate)
CREATE TABLE IF NOT EXISTS public.proofs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_item_id UUID REFERENCES public.order_items(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  version_number INT NOT NULL DEFAULT 1,
  status proof_status NOT NULL DEFAULT 'pending_review',
  watermarked_preview_url TEXT NOT NULL,
  customer_feedback TEXT,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. PRODUCTION FILES (High-res 300 DPI - Locked until approved)
CREATE TABLE IF NOT EXISTS public.production_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proof_id UUID REFERENCES public.proofs(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id UUID REFERENCES public.order_items(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  resolution_dpi INT NOT NULL DEFAULT 300,
  bleed_mm NUMERIC(4,2) NOT NULL DEFAULT 3.00,
  is_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  download_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. SAVED DESIGNS (One-click reorder library)
CREATE TABLE IF NOT EXISTS public.saved_designs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width_mm INT NOT NULL,
  height_mm INT NOT NULL,
  material TEXT NOT NULL,
  canvas_state JSONB NOT NULL,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id),
  actor_name TEXT NOT NULL,
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_designs ENABLE ROW LEVEL SECURITY;

-- Customers can read their own profiles; Admins can read all
CREATE POLICY "Profiles access" ON public.profiles
  FOR ALL USING (auth.uid() = id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Customers can read/create their own orders
CREATE POLICY "Orders customer access" ON public.orders
  FOR SELECT USING (auth.uid() = customer_id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Customers can read proofs for their own orders; Admins can read all
CREATE POLICY "Proofs customer access" ON public.proofs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = proofs.order_id
      AND (orders.customer_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
    )
  );

-- Customers can read and manage their own saved designs; Admins can read all
CREATE POLICY "Saved designs customer access" ON public.saved_designs
  FOR ALL USING (auth.uid() = customer_id OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');

-- Customers can read order items for their own orders; Admins can read all
CREATE POLICY "Order items customer access" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
      AND (orders.customer_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin')
    )
  );

-- Production files can only be accessed by admins, and only when unlocked or for staff
CREATE POLICY "Production files admin access" ON public.production_files
  FOR ALL USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin');


-- ==============================================================================
-- 13. SEED DATA (Divisions & Parameter-Driven Products)
-- ==============================================================================

INSERT INTO public.divisions (slug, name, tagline, description, icon, accent_color, order_index) VALUES
  ('labels-stickers', 'Labels & Stickers', 'Precision die-cut, kiss-cut & product labels', 'Durable vinyls, metallic foils, and waterproof adhesives engineered for brands, packaging, and outdoor gear.', 'Sticker', '#FF5A1F', 1),
  ('race-event-numbers', 'Race & Event Numbers', 'Tear-proof Tyvek bibs & variable athlete IDs', 'Weather-resistant, sweat-proof racing bibs with automated CSV data merge for athlete names, categories, and barcodes.', 'Flag', '#2563EB', 2),
  ('mtb-boards', 'MTB Boards', 'Heavy-duty downhill & enduro number plates', 'Flexible, ultra-durable 0.8mm Polypropylene plates built to survive mud, rock strikes, and high-pressure jet washing.', 'Bike', '#16A34A', 3),
  ('stamps', 'Stamps', 'Self-inking & custom laser-etched stamps', 'Sharp, high-resolution rubber impression stamps for return addresses, business endorsements, and packaging seals.', 'Stamp', '#9333EA', 4),
  ('trophies', 'Trophies & Awards', 'Custom acrylic, laser-engraved wood & metal plates', 'Distinctive podium awards, corporate recognition crystal, and laser-engraved anodised aluminium plaque plates.', 'Trophy', '#D97706', 5),
  ('laser-cut', 'Laser-Cut Work', 'Precision industrial cutting, stencils & signage', 'Sub-millimeter accurate vector laser cutting across acrylic, plywood, MDF, card stock, and heavy gasket materials.', 'Flame', '#DC2626', 6)
ON CONFLICT (slug) DO NOTHING;

-- Seed Products
INSERT INTO public.products (division_id, slug, name, subtitle, description, base_price_cents, price_per_sq_cm_cents, min_width_mm, max_width_mm, min_height_mm, max_height_mm, default_width_mm, default_height_mm, default_bleed_mm, default_safety_margin_mm, allowed_materials, has_variable_data, image_url)
SELECT 
  id,
  'custom-die-cut-vinyl',
  'Custom Die-Cut Vinyl Stickers',
  'Heavyweight outdoor vinyl with protective UV laminate',
  'Thick 100-micron vinyl with scratch-resistant gloss or matte laminate. Cut cleanly to your exact vector contour line.',
  18,
  4,
  25, 350,
  25, 350,
  75, 75,
  3.00, 2.50,
  '[{"id": "gloss-white", "name": "Gloss White Vinyl", "multiplier": 1.0, "badge": "Popular"}, {"id": "matte-white", "name": "Matte White Vinyl", "multiplier": 1.05}, {"id": "holographic", "name": "Holographic Rainbow", "multiplier": 1.45, "badge": "Premium"}]'::jsonb,
  false,
  'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=800&q=80'
FROM public.divisions WHERE slug = 'labels-stickers'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.products (division_id, slug, name, subtitle, description, base_price_cents, price_per_sq_cm_cents, min_width_mm, max_width_mm, min_height_mm, max_height_mm, default_width_mm, default_height_mm, default_bleed_mm, default_safety_margin_mm, allowed_materials, has_variable_data, image_url)
SELECT 
  id,
  'tyvek-race-bibs',
  'Tyvek Race Bibs (Variable Data)',
  'Tear-resistant, waterproof numbers with automated CSV merge',
  'Standard or custom-sized event bibs printed on authentic DuPont Tyvek. Ready for CSV upload of athlete names and barcode numbering.',
  35,
  3,
  100, 250,
  100, 220,
  210, 148,
  3.00, 5.00,
  '[{"id": "tyvek-54gsm", "name": "DuPont Tyvek 54gsm", "multiplier": 1.0, "badge": "Standard"}, {"id": "synthetic-waterproof", "name": "Synaps Waterproof Poly", "multiplier": 1.35}]'::jsonb,
  true,
  'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=800&q=80'
FROM public.divisions WHERE slug = 'race-event-numbers'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.products (division_id, slug, name, subtitle, description, base_price_cents, price_per_sq_cm_cents, min_width_mm, max_width_mm, min_height_mm, max_height_mm, default_width_mm, default_height_mm, default_bleed_mm, default_safety_margin_mm, allowed_materials, has_variable_data, image_url)
SELECT 
  id,
  'downhill-mtb-number-board',
  'Downhill & Enduro Number Boards',
  '0.8mm Polypropylene custom profile with zip-tie punch slots',
  'Impact-grade flexible bike boards that wrap around brake cables and withstand rock sprays. Sub-surface printed to resist jet washing.',
  180,
  6,
  140, 220,
  120, 180,
  175, 155,
  4.00, 8.00,
  '[{"id": "polyprop-08", "name": "0.8mm Flexible Polypropylene", "multiplier": 1.0, "badge": "Factory Spec"}, {"id": "polycarb-heavy", "name": "1.0mm Heavy Polycarbonate", "multiplier": 1.5}]'::jsonb,
  true,
  'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=800&q=80'
FROM public.divisions WHERE slug = 'mtb-boards'
ON CONFLICT (slug) DO NOTHING;
