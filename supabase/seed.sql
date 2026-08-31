-- =============================================================================
-- Seed — taxonomies.
--
-- Idempotent, and safe to run against production. Demo accounts and sample
-- listings live in seed-demo.sql, applied separately by scripts/seed-demo.mjs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Governorates
-- ---------------------------------------------------------------------------

insert into governorates (name_ar, name_en, slug) values
  ('القاهرة',    'Cairo',      'cairo'),
  ('الجيزة',     'Giza',       'giza'),
  ('الإسكندرية', 'Alexandria', 'alexandria'),
  ('الدقهلية',   'Dakahlia',   'dakahlia'),
  ('الغربية',    'Gharbia',    'gharbia'),
  ('مطروح',      'Matrouh',    'matrouh'),
  ('السويس',     'Suez',       'suez')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Districts — Greater Cairo first, then the secondary markets.
-- ---------------------------------------------------------------------------

insert into districts (governorate_id, name_ar, name_en, slug)
select g.id, d.name_ar, d.name_en, d.slug
from (values
  ('cairo',      'التجمع الخامس',        'New Cairo',       'new-cairo'),
  ('cairo',      'مدينة نصر',            'Nasr City',       'nasr-city'),
  ('cairo',      'مصر الجديدة',          'Heliopolis',      'heliopolis'),
  ('cairo',      'المعادي',              'Maadi',           'maadi'),
  ('cairo',      'الزمالك',              'Zamalek',         'zamalek'),
  ('cairo',      'المقطم',               'Mokattam',        'mokattam'),
  ('cairo',      'الشروق',               'Shorouk',         'shorouk'),
  ('cairo',      'العبور',               'Obour',           'obour'),
  ('cairo',      'الرحاب',               'Rehab',           'rehab'),
  ('cairo',      'مدينتي',               'Madinaty',        'madinaty'),
  ('cairo',      'العاصمة الإدارية',      'New Capital',     'new-capital'),
  ('cairo',      'وسط البلد',            'Downtown',        'downtown'),
  ('giza',       'الشيخ زايد',           'Sheikh Zayed',    'sheikh-zayed'),
  ('giza',       '6 أكتوبر',             '6th of October',  '6th-of-october'),
  ('giza',       'المهندسين',            'Mohandessin',     'mohandessin'),
  ('matrouh',    'الساحل الشمالي',        'North Coast',     'north-coast'),
  ('suez',       'العين السخنة',          'Ain Sokhna',      'ain-sokhna'),
  ('alexandria', 'سموحة',                'Smouha',          'smouha'),
  ('alexandria', 'سيدي جابر',            'Sidi Gaber',      'sidi-gaber'),
  ('dakahlia',   'المنصورة',             'Mansoura',        'mansoura'),
  ('gharbia',    'طنطا',                 'Tanta',           'tanta')
) as d(gov_slug, name_ar, name_en, slug)
join governorates g on g.slug = d.gov_slug
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Developers — a portfolio tag, not a company list. Brokerages stay out.
-- ---------------------------------------------------------------------------

insert into developers (name_ar, name_en, slug) values
  ('مجموعة طلعت مصطفى', 'Talaat Moustafa Group', 'talaat-moustafa-group'),
  ('سوديك',             'SODIC',                 'sodic'),
  ('بالم هيلز',          'Palm Hills',            'palm-hills'),
  ('أورا للتطوير',       'Ora Developers',        'ora-developers'),
  ('ماونتن فيو',         'Mountain View',         'mountain-view'),
  ('مصر إيطاليا',        'Misr Italia',           'misr-italia'),
  ('هايد بارك',          'Hyde Park',             'hyde-park'),
  ('إعمار مصر',          'Emaar Misr',            'emaar-misr'),
  ('مدينة مصر',          'Madinet Masr',          'madinet-masr'),
  ('مدينة نصر للإسكان',  'MNHD',                  'mnhd'),
  ('تطوير مصر',          'Tatweer Misr',          'tatweer-misr'),
  ('مراكز',             'Marakez',               'marakez'),
  ('سيتي إيدج',          'City Edge',             'city-edge'),
  ('الأهلي صبور',        'Al Ahly Sabbour',       'al-ahly-sabbour'),
  ('إل إم دي',           'LMD',                   'lmd'),
  ('إيوان',             'IWAN',                  'iwan'),
  ('أوراسكوم',          'Orascom',               'orascom')
on conflict (slug) do nothing;
