-- ============================================================================
-- Diamond & gemstone jewellery categories.
-- Run in the Supabase SQL Editor. Safe to re-run: only adds categories that are
-- missing; existing categories and products are not changed.
-- Admin can rename, add or deactivate any of these in Inventory > Categories.
-- ============================================================================
INSERT INTO public.categories (name_en, name_ta, is_active, sort_order)
SELECT v.name_en, '', TRUE, v.sort_order
FROM (VALUES
  ('Gold with Diamond', 30),
  ('Platinum with Diamond', 31),
  ('Silver with Diamond', 32),
  ('Gold with Gemstones', 33),
  ('Platinum with Gemstones', 34),
  ('Diamond Rings', 35),
  ('Engagement Rings', 36),
  ('Wedding Rings', 37),
  ('Diamond Necklaces', 38),
  ('Diamond Chains', 39),
  ('Diamond Bangles', 40),
  ('Diamond Bracelets', 41),
  ('Diamond Earrings', 42),
  ('Diamond Studs', 43),
  ('Diamond Pendants', 44),
  ('Bridal Sets', 45),
  ('Tennis Bracelets', 46),
  ('Solitaire Jewellery', 47),
  ('Men''s Jewellery', 48),
  ('Loose Diamonds', 49),
  ('Loose Gemstones', 50),
  ('Coins and Bars', 51)
) AS v(name_en, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE LOWER(BTRIM(c.name_en)) = LOWER(v.name_en));
