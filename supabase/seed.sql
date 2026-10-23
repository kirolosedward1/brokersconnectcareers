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

-- ---------------------------------------------------------------------------
-- Search aliases — what a place or a specialisation is also called.
--
-- The rule for a row here: a name people in this market genuinely use for
-- exactly this district or track, that the taxonomy's own Arabic and English
-- names do not already contain. Not a spelling variant the normaliser already
-- folds (أ/ا, ة/ه, ى/ي), not a word that is merely related, and never a
-- neighbouring area — «الرحاب» is not «التجمع», however close it is.
--
-- The track rows restate the labels in messages/*.json, because those labels
-- are what a reader sees on every card and so the first thing they type.
-- Change a label there and change it here.
--
-- Migration 342 inserts the same rows into a database whose taxonomy was
-- seeded before they existed (production). A change here needs a migration
-- too; supabase/tests/search.test.mjs compares the two.
-- ---------------------------------------------------------------------------

insert into search_aliases (district_id, alias)
select d.id, a.alias
from (values
  ('new-cairo',      'القاهرة الجديدة'),
  ('new-cairo',      'Fifth Settlement'),
  ('new-cairo',      '5th Settlement'),
  ('new-cairo',      'Tagamoa'),
  ('new-capital',    'العاصمة الإدارية الجديدة'),
  ('new-capital',    'New Administrative Capital'),
  ('6th-of-october', 'السادس من أكتوبر'),
  ('6th-of-october', '6 October'),
  ('north-coast',    'Sahel'),
  ('mohandessin',    'Mohandeseen'),
  ('mokattam',       'Moqattam')
) as a(slug, alias)
join districts d on d.slug = a.slug
on conflict on constraint search_aliases_unique do nothing;

insert into search_aliases (track, alias)
select a.track::job_track, a.alias
from (values
  -- The label reads "عقارات قيد الإنشاء" now; "بيع أول" stays an alias because
  -- it is still what the market says and what people type into the box.
  ('primary',             'عقارات قيد الإنشاء'),
  ('primary',             'قيد الإنشاء'),
  ('primary',             'بيع أول'),
  ('primary',             'Primary sales'),
  ('primary',             'Off-plan'),
  ('primary',             'برايمري'),
  ('resale',              'إعادة بيع'),
  ('resale',              'Resale'),
  ('resale',              'ريسيل'),
  ('rental',              'إيجارات'),
  ('rental',              'Rentals'),
  ('commercial',          'عقارات تجارية'),
  ('commercial',          'Commercial'),
  ('property_management', 'إدارة أملاك'),
  ('property_management', 'Property management'),
  ('back_office',         'دعم ومساندة'),
  ('back_office',         'Back office')
) as a(track, alias)
on conflict on constraint search_aliases_unique do nothing;
