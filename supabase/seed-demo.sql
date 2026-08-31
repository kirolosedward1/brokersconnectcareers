-- =============================================================================
-- Demo dataset — application rows only.
--
-- This file deliberately does NOT create auth users. Creating them in SQL works
-- on a stubbed local schema but not against a real Supabase project: GoTrue also
-- needs a matching `auth.identities` row, and its column shape moves between
-- versions, so a hand-rolled insert produces an account that cannot sign in.
--
-- The caller creates the users and passes their ids in as a single JSON map:
--   scripts/seed-demo.mjs      creates them through the Auth admin API
--   supabase/tests/setup.mjs   inserts them into its own stubbed auth schema
--
-- Both then set `demo.users` and run this file.
-- =============================================================================

do $$
declare
  u jsonb := current_setting('demo.users')::jsonb;

  -- Companies get fixed ids so re-running is a no-op.
  co_rowad    uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  co_hub      uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  co_capital  uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  co_nile     uuid := 'aaaaaaaa-0000-0000-0000-000000000004';
  co_safwa    uuid := 'aaaaaaaa-0000-0000-0000-000000000005';
  co_westgate uuid := 'aaaaaaaa-0000-0000-0000-000000000006';
  co_skyline  uuid := 'aaaaaaaa-0000-0000-0000-000000000007';

  d_new_cairo   int; d_zayed    int; d_october int; d_nasr     int;
  d_heliopolis  int; d_maadi    int; d_capital int; d_madinaty int;
  d_north_coast int; d_mohandessin int;
begin
  if exists (select 1 from companies where id = co_rowad) then
    raise notice 'demo data already present — skipping';
    return;
  end if;

  select id into d_new_cairo    from districts where slug = 'new-cairo';
  select id into d_zayed        from districts where slug = 'sheikh-zayed';
  select id into d_october      from districts where slug = '6th-of-october';
  select id into d_nasr         from districts where slug = 'nasr-city';
  select id into d_heliopolis   from districts where slug = 'heliopolis';
  select id into d_maadi        from districts where slug = 'maadi';
  select id into d_capital      from districts where slug = 'new-capital';
  select id into d_madinaty     from districts where slug = 'madinaty';
  select id into d_north_coast  from districts where slug = 'north-coast';
  select id into d_mohandessin  from districts where slug = 'mohandessin';

  -- ---------------------------------------------------------------------------
  -- Profiles
  -- ---------------------------------------------------------------------------
  insert into profiles (id, role, full_name, whatsapp_phone, locale) values
    ((u->>'employer1')::uuid,  'employer',  'محمد عبد الرحمن', '+201001234567', 'ar'),
    ((u->>'employer2')::uuid,  'employer',  'سارة فتحي',       '+201009876543', 'ar'),
    ((u->>'employer3')::uuid,  'employer',  'كريم الشناوي',    '+201005551122', 'ar'),
    ((u->>'employer4')::uuid,  'employer',  'داليا مرسي',      '+201007778899', 'ar'),
    ((u->>'employer5')::uuid,  'employer',  'أحمد بدوي',       '+201002223344', 'ar'),
    ((u->>'employer6')::uuid,  'employer',  'نهى السيد',       '+201006665544', 'ar'),
    ((u->>'employer7')::uuid,  'employer',  'طارق منير',       '+201003334455', 'ar'),
    ((u->>'candidate1')::uuid, 'candidate', 'أحمد محمود',      '+201112223344', 'ar'),
    ((u->>'candidate2')::uuid, 'candidate', 'منة الله شريف',   '+201118887766', 'ar'),
    ((u->>'candidate3')::uuid, 'candidate', 'يوسف عادل',       '+201114445566', 'ar'),
    ((u->>'candidate4')::uuid, 'candidate', 'هبة رمضان',       '+201119990011', 'ar'),
    ((u->>'candidate5')::uuid, 'candidate', 'مصطفى الجندي',    '+201116667788', 'ar'),
    ((u->>'candidate6')::uuid, 'candidate', 'رنا حسام',        '+201113332211', 'ar'),
    ((u->>'candidate7')::uuid, 'candidate', 'عمرو صلاح',       '+201115554433', 'ar'),
    ((u->>'admin')::uuid,      'admin',     'المشرف',          '+201000000000', 'ar');

  -- ---------------------------------------------------------------------------
  -- Companies. Unverified ones are capped at one active listing by the database,
  -- so the mix below is deliberate rather than arbitrary.
  -- ---------------------------------------------------------------------------
  insert into companies (id, owner_id, name_ar, name_en, slug, about_ar, headcount_band,
                         district_id, verification_status, verified_at) values
    (co_rowad, (u->>'employer1')::uuid, 'شركة الرواد العقارية', 'Al Rowad Real Estate', 'al-rowad-real-estate-309047',
     'شركة تسويق عقاري متخصصة في البيع الأول لمشروعات التجمع الخامس والعاصمة الإدارية، شغالة في السوق المصري من 2014.',
     '51_200', d_new_cairo, 'verified', now()),

    (co_hub, (u->>'employer2')::uuid, 'بروبرتي هب', 'Property Hub', 'property-hub-297685',
     'وسيط عقاري بيغطي غرب القاهرة، متخصص في إعادة البيع والإيجارات بالشيخ زايد و6 أكتوبر.',
     '11_50', d_zayed, 'unverified', null),

    (co_capital, (u->>'employer3')::uuid, 'كابيتال هومز', 'Capital Homes', 'capital-homes-638162',
     'من أكبر بيوت التسويق العقاري في العاصمة الإدارية، وبتشتغل على محافظ كبار المطورين بفرق بيع كبيرة.',
     '201_500', d_capital, 'verified', now()),

    (co_nile, (u->>'employer4')::uuid, 'نايل بروكرز', 'Nile Brokers', 'nile-brokers-410256',
     'مكتب عقاري في المعادي متخصص في الإيجارات السكنية للأجانب والشركات، وفي إدارة الأملاك.',
     '11_50', d_maadi, 'verified', now()),

    (co_safwa, (u->>'employer5')::uuid, 'الصفوة للاستثمار العقاري', 'Al Safwa Real Estate', 'al-safwa-real-estate-576838',
     'شركة استثمار عقاري في مدينة نصر، بتشتغل على البيع الأول والعقارات التجارية.',
     '51_200', d_nasr, 'unverified', null),

    (co_westgate, (u->>'employer6')::uuid, 'ويست جيت العقارية', 'West Gate Realty', 'west-gate-realty-806267',
     'فريق بيع في 6 أكتوبر وزايد، شغال على كمبوندات المطورين الكبار في غرب القاهرة.',
     '11_50', d_october, 'verified', now()),

    (co_skyline, (u->>'employer7')::uuid, 'سكاي لاين بروبرتيز', 'Skyline Properties', 'skyline-properties-181976',
     'مكتب صغير في مصر الجديدة متخصص في العقارات التجارية والإدارية.',
     '1_10', d_heliopolis, 'verified', now());

  -- ---------------------------------------------------------------------------
  -- Jobs. Spread across track, district, leads source, pay shape and experience
  -- so every filter on /jobs returns something.
  -- ---------------------------------------------------------------------------
  insert into jobs (
    company_id, title_ar, title_en, slug, track, employment_type, experience_band, seats,
    district_id, basic_salary_min, basic_salary_max, commission_type, commission_value,
    commission_note_ar, leads_source, benefits, description_ar, requirements_ar, status, is_featured
  ) values
    (co_rowad, 'استشاري عقاري - بيع أول', 'Property Consultant - Primary Sales',
     'property-consultant-primary-new-cairo-562624', 'primary', 'full_time', 'junior_1_3', 25, d_new_cairo,
     6000, 9000, 'percentage', 2.50,
     'عمولة 2.5٪ من قيمة الوحدة بتتصرف بعد تحصيل الدفعة التانية.', 'company_provided',
     array['social_insurance','medical','transport','training'],
     'مطلوب استشاريين عقاريين للشغل على مشروعات كبار المطورين في التجمع الخامس والعاصمة الإدارية. العميل بييجي من إدارة التسويق، والاستشاري مش مطلوب منه يجيب عملاء من مصادره. في برنامج تدريبي مدفوع أسبوعين قبل ما تنزل السوق.',
     'خبرة من سنة لـ 3 سنين في البيع العقاري، تواصل كويس بالعربي، ويفضّل إلمام بالإنجليزي. رخصة قيادة وعربية ملاكي ميزة إضافية.',
     'active', true),

    (co_rowad, 'مدير فريق مبيعات عقارية', 'Real Estate Sales Team Leader',
     'sales-team-leader-new-cairo-689464', 'primary', 'full_time', 'senior_5_plus', 3, d_new_cairo,
     18000, 25000, 'split', null,
     'نسبة تقسيم على تحقيق الفريق للتارجت الشهري.', 'company_provided',
     array['social_insurance','medical','mobile_allowance'],
     'إدارة فريق من 12 استشاري عقاري، ومتابعة التارجت الشهري وربع السنوي، والمشاركة في اختيار وتدريب أعضاء الفريق الجداد.',
     'خبرة مش أقل من 5 سنين في البيع العقاري، منها سنتين في إدارة فريق. سجل مثبت في تحقيق تارجت.',
     'active', false),

    (co_rowad, 'أخصائي تسويق عقاري رقمي', 'Digital Real Estate Marketing Specialist',
     'digital-marketing-specialist-new-cairo-904967', 'back_office', 'full_time', 'mid_3_5', 2, d_new_cairo,
     12000, 16000, 'none', null, null, 'company_provided',
     array['social_insurance','medical','training'],
     'إدارة حملات الليدز على فيسبوك وجوجل لمشروعات الشركة، ومتابعة تكلفة الليد وجودته مع فرق البيع.',
     'خبرة 3 سنين في التسويق الرقمي، ويفضّل خبرة سابقة في القطاع العقاري. إجادة التعامل مع Meta Ads Manager.',
     'active', false),

    (co_hub, 'مسؤول إعادة بيع وإيجارات', 'Resale & Rentals Agent',
     'resale-rentals-agent-sheikh-zayed-925981', 'resale', 'freelance_commission_only', 'fresh_0_1', 10, d_zayed,
     null, null, 'percentage', 2.00,
     'عمولة 2٪ بتتقسم مناصفة بين الشركة والوسيط.', 'self_generated',
     array['training'],
     'فرصة للشغل الحر في سوق إعادة البيع والإيجارات بغرب القاهرة. مفيش راتب أساسي — الدخل كله من العمولة. الشركة بتوفّر مقر شغل وأدوات تسويق ودعم قانوني لإتمام التعاقدات.',
     'مش شرط خبرة سابقة. مطلوب جدية والتزام بمواعيد الشغل ومهارة تواصل كويسة.',
     'active', false),

    (co_hub, 'مسؤول تسويق عقاري', 'Real Estate Marketing Officer',
     'marketing-officer-sheikh-zayed-964311', 'back_office', 'full_time', 'junior_1_3', 1, d_zayed,
     8000, 10000, 'none', null, null, 'company_provided',
     array['social_insurance'],
     'إدارة السوشيال ميديا وحملات الليدز للمكتب، ومتابعة الردود على الاستفسارات وتحويلها لفريق البيع.',
     'خبرة سنة لـ 3 سنين في التسويق الرقمي، ويفضّل خبرة في العقارات.',
     'pending_review', false),

    (co_capital, 'استشاري بيع - العاصمة الإدارية', 'Sales Consultant - New Capital',
     'sales-consultant-new-capital-814806', 'primary', 'full_time', 'fresh_0_1', 40, d_capital,
     7000, 10000, 'percentage', 2.25,
     'عمولة 2.25٪ بتتصرف على مرحلتين مع دفعات العميل.', 'company_provided',
     array['social_insurance','medical','transport','training','mobile_allowance'],
     'كابيتال هومز بتفتح 4 فرق بيع جديدة للعاصمة الإدارية. الشغل على محافظ كبار المطورين، والعملاء بييجوا من حملات الشركة. تدريب مكثف 3 أسابيع قبل ما تنزل السوق.',
     'خريجين جداد مرحب بيهم. مطلوب مظهر لائق ومهارة تواصل عالية واستعداد للشغل بنظام التارجت.',
     'active', true),

    (co_capital, 'مدير مبيعات أول', 'Senior Sales Manager',
     'senior-sales-manager-new-capital-693189', 'primary', 'full_time', 'senior_5_plus', 2, d_capital,
     30000, 45000, 'split', null,
     'تقسيم عمولة على تحقيق القطاع بالكامل، بالإضافة لبونص ربع سنوي.', 'company_provided',
     array['social_insurance','medical','mobile_allowance','transport'],
     'إدارة قطاع مبيعات كامل مكوّن من 4 فرق، والمسؤولية عن التارجت الربع سنوي وعلاقات المطورين.',
     'خبرة مش أقل من 8 سنين في السوق العقاري المصري، منها 3 سنين في إدارة قطاع أو أكتر من فريق.',
     'active', false),

    (co_capital, 'أخصائي دعم مبيعات', 'Sales Support Specialist',
     'sales-support-specialist-new-capital-881241', 'back_office', 'full_time', 'fresh_0_1', 5, d_capital,
     7000, 8500, 'none', null, null, 'company_provided',
     array['social_insurance','transport'],
     'دعم فرق البيع في إعداد العروض والعقود وإدخال بيانات العملاء على نظام إدارة العلاقات، ومتابعة ملفات الحجز مع المطورين.',
     'إجادة Excel، ودقة في إدخال البيانات، وخبرة لحد سنة في وظيفة إدارية.',
     'active', false),

    (co_nile, 'أخصائي إيجارات سكنية', 'Residential Lettings Agent',
     'residential-lettings-agent-maadi-527622', 'rental', 'full_time', 'junior_1_3', 4, d_maadi,
     8000, 11000, 'percentage', 5.00,
     'عمولة 5٪ من قيمة عقد الإيجار السنوي.', 'hybrid',
     array['social_insurance','medical','transport'],
     'الشغل على تأجير الشقق والفيلات في المعادي ودجلة لعملاء أجانب وشركات. جزء من العملاء بييجي من الشركة، وجزء من شبكة علاقاتك.',
     'إجادة الإنجليزي شرط أساسي. خبرة سنة لـ 3 سنين في الإيجارات أو البيع العقاري.',
     'active', false),

    (co_nile, 'مسؤول إدارة أملاك', 'Property Management Officer',
     'property-management-officer-maadi-980123', 'property_management', 'full_time', 'mid_3_5', 2, d_maadi,
     10000, 14000, 'none', null, null, 'company_provided',
     array['social_insurance','medical','transport','mobile_allowance'],
     'إدارة محفظة وحدات مؤجرة نيابة عن الملاك: متابعة التحصيل، والصيانة، وتجديد العقود، والتعامل مع شكاوى المستأجرين.',
     'خبرة 3 سنين في إدارة الأملاك أو الإيجارات. تنظيم عالي وقدرة على التعامل مع أطراف متعددة.',
     'active', false),

    (co_safwa, 'استشاري عقارات تجارية', 'Commercial Real Estate Consultant',
     'commercial-consultant-nasr-city-890956', 'commercial', 'full_time', 'mid_3_5', 3, d_nasr,
     11000, 15000, 'percentage', 1.50,
     'عمولة 1.5٪ على قيمة الصفقة، بتتصرف بعد التعاقد.', 'hybrid',
     array['social_insurance','medical'],
     'بيع وتأجير محلات ومكاتب إدارية في مدينة نصر ومصر الجديدة، والتعامل مع مستثمرين وأصحاب علامات تجارية.',
     'خبرة 3 لـ 5 سنين في العقارات، ويفضّل خبرة في القطاع التجاري تحديداً.',
     'active', false),

    (co_westgate, 'استشاري عقاري - غرب القاهرة', 'Property Consultant - West Cairo',
     'property-consultant-6th-of-october-765377', 'primary', 'full_time', 'junior_1_3', 12, d_october,
     6500, 9500, 'percentage', 2.75,
     'عمولة 2.75٪ بتتصرف بعد تحصيل 25٪ من قيمة الوحدة.', 'company_provided',
     array['social_insurance','medical','transport','training'],
     'الشغل على كمبوندات غرب القاهرة في 6 أكتوبر وزايد. العملاء بييجوا من حملات الشركة، والتدريب على المشروعات مستمر.',
     'خبرة سنة لـ 3 سنين في البيع، مش شرط عقاري. مطلوب سيارة أو استعداد للتنقل بين المشروعات.',
     'active', false),

    (co_westgate, 'مسوّق عقاري بالعمولة', 'Commission-only Property Agent',
     'commission-only-agent-sheikh-zayed-189254', 'resale', 'freelance_commission_only', 'junior_1_3', 15, d_zayed,
     null, null, 'percentage', 3.00,
     'عمولة 3٪ كاملة للوسيط على الصفقات اللي بيقفلها بنفسه.', 'self_generated',
     array[]::text[],
     'للمسوّقين اللي عندهم شبكة علاقات في غرب القاهرة وعايزين يشتغلوا لحسابهم تحت مظلة شركة. مفيش تارجت ملزم ومفيش مواعيد حضور.',
     'شبكة علاقات في زايد أو أكتوبر، وخبرة سابقة في إعادة البيع.',
     'active', false),

    (co_skyline, 'أخصائي تأجير مكاتب إدارية', 'Office Leasing Specialist',
     'office-leasing-specialist-heliopolis-941668', 'commercial', 'part_time', 'mid_3_5', 1, d_heliopolis,
     9000, 12000, 'percentage', 4.00,
     'عمولة 4٪ من قيمة العقد السنوي.', 'hybrid',
     array['social_insurance'],
     'تأجير مساحات إدارية في مصر الجديدة والقاهرة الجديدة لشركات ناشئة ومكاتب متوسطة. دوام جزئي 4 أيام في الأسبوع.',
     'خبرة 3 سنين في العقارات التجارية أو الإدارية. إجادة الإنجليزي.',
     'active', false),

    (co_rowad, 'استشاري عقاري - مدينتي', 'Property Consultant - Madinaty',
     'property-consultant-madinaty-484856', 'primary', 'full_time', 'fresh_0_1', 8, d_madinaty,
     6000, 8000, 'percentage', 2.00,
     'عمولة 2٪ بتتصرف مع دفعات العميل.', 'company_provided',
     array['social_insurance','transport','training'],
     'فريق جديد مخصص لمشروعات مدينتي والشروق. مناسب للخريجين الجداد اللي عايزين يبدأوا في البيع الأول بتدريب منظم.',
     'خريجين جداد مرحب بيهم. مطلوب التزام ومهارة تواصل.',
     'active', false),

    (co_nile, 'أخصائي إيجارات - الساحل الشمالي (موسمي)', 'Seasonal Lettings Agent - North Coast',
     'seasonal-lettings-north-coast-969125', 'rental', 'part_time', 'fresh_0_1', 6, d_north_coast,
     null, null, 'percentage', 6.00,
     'عمولة 6٪ على عقود الإيجار الموسمية.', 'hybrid',
     array[]::text[],
     'شغل موسمي على تأجير الوحدات في الساحل الشمالي خلال الصيف. مناسب لطلبة أو حد بيدوّر على دخل إضافي موسمي.',
     'مش شرط خبرة. مطلوب تواجد في الساحل خلال الموسم.',
     'active', false),

    (co_skyline, 'مساعد إداري - مكتب عقاري', 'Office Administrator',
     'office-administrator-mohandessin-899346', 'back_office', 'full_time', 'fresh_0_1', 1, d_mohandessin,
     6500, 8000, 'none', null, null, 'company_provided',
     array['social_insurance'],
     'أعمال إدارية لمكتب عقاري صغير: تنظيم المواعيد، ومتابعة الملفات، والرد على استفسارات العملاء.',
     'إجادة الكمبيوتر، وتنظيم، ومهارة تواصل. خبرة إدارية سنة على الأكثر.',
     'pending_review', false),

    (co_capital, 'استشاري عقاري - مصر الجديدة', 'Property Consultant - Heliopolis',
     'property-consultant-heliopolis-863563', 'resale', 'full_time', 'mid_3_5', 4, d_heliopolis,
     9000, 13000, 'percentage', 2.50,
     'عمولة 2.5٪ على صفقات إعادة البيع.', 'hybrid',
     array['social_insurance','medical','mobile_allowance'],
     'الشغل على سوق إعادة البيع في مصر الجديدة وشرق القاهرة، مع محفظة وحدات موجودة عند الشركة.',
     'خبرة 3 لـ 5 سنين في إعادة البيع، ومعرفة كويسة بمنطقة مصر الجديدة.',
     'draft', false);

  -- Developer portfolio tags
  insert into job_developers (job_id, developer_id)
  select j.id, d.id from jobs j, developers d
  where (j.slug = 'property-consultant-primary-new-cairo-562624' and d.slug in ('talaat-moustafa-group','city-edge','ora-developers'))
     or (j.slug = 'sales-consultant-new-capital-814806'          and d.slug in ('city-edge','misr-italia','tatweer-misr'))
     or (j.slug = 'property-consultant-6th-of-october-765377'    and d.slug in ('sodic','palm-hills','mountain-view'))
     or (j.slug = 'property-consultant-madinaty-484856'          and d.slug in ('talaat-moustafa-group'))
     or (j.slug = 'senior-sales-manager-new-capital-693189'      and d.slug in ('city-edge','madinet-masr'));

  -- ---------------------------------------------------------------------------
  -- Agent directory. Visibility is spread on purpose: the gate is only
  -- convincing in a demo when some profiles are public, some gated and one is
  -- hidden from everyone including their own employer.
  -- ---------------------------------------------------------------------------
  insert into agent_profiles (user_id, slug, headline_ar, headline_en, years_experience,
                              tracks, district_ids, languages, availability, visibility) values
    ((u->>'candidate1')::uuid, 'ahmed-mahmoud-818804',
     'استشاري عقاري - بيع أول في التجمع والعاصمة الإدارية',
     'Primary sales consultant — New Cairo & New Capital', 4,
     array['primary','resale']::job_track[], array[d_new_cairo, d_capital],
     array['ar','en'], 'employed_not_looking', 'verified_employers_only'),

    ((u->>'candidate2')::uuid, 'menna-sherif-909521',
     'أخصائية إيجارات سكنية للأجانب والشركات في المعادي',
     'Residential lettings specialist — Maadi', 6,
     array['rental','property_management']::job_track[], array[d_maadi, d_heliopolis],
     array['ar','en','fr'], 'open_to_offers', 'public'),

    ((u->>'candidate3')::uuid, 'youssef-adel-432606',
     'مسوّق عقاري بالعمولة - غرب القاهرة',
     'Commission-only agent — West Cairo', 2,
     array['resale']::job_track[], array[d_zayed, d_october],
     array['ar'], 'actively_searching', 'public'),

    ((u->>'candidate4')::uuid, 'heba-ramadan-625784',
     'مديرة فريق بيع أول - العاصمة الإدارية',
     'Primary sales team leader — New Capital', 9,
     array['primary']::job_track[], array[d_capital, d_new_cairo],
     array['ar','en'], 'open_to_offers', 'verified_employers_only'),

    ((u->>'candidate5')::uuid, 'mostafa-elgendy-339125',
     'استشاري عقارات تجارية وإدارية',
     'Commercial and office space consultant', 7,
     array['commercial']::job_track[], array[d_nasr, d_heliopolis, d_mohandessin],
     array['ar','en'], 'employed_not_looking', 'hidden'),

    ((u->>'candidate6')::uuid, 'rana-hossam-897283',
     'خريجة جديدة - مهتمة بالبيع الأول',
     'Fresh graduate — interested in primary sales', 0,
     array['primary']::job_track[], array[d_october, d_zayed],
     array['ar','en'], 'actively_searching', 'public'),

    ((u->>'candidate7')::uuid, 'amr-salah-541004',
     'أخصائي إدارة أملاك ومحافظ إيجارية',
     'Property management and rental portfolio specialist', 5,
     array['property_management','rental']::job_track[], array[d_maadi, d_madinaty],
     array['ar'], 'open_to_offers', 'verified_employers_only');

  insert into agent_developers (agent_id, developer_id)
  select a.id, d.id from agent_profiles a, developers d
  where (a.slug = 'ahmed-mahmoud-818804'   and d.slug in ('sodic','palm-hills'))
     or (a.slug = 'heba-ramadan-625784'    and d.slug in ('city-edge','talaat-moustafa-group','misr-italia'))
     or (a.slug = 'youssef-adel-432606'    and d.slug in ('mountain-view'))
     or (a.slug = 'amr-salah-541004'       and d.slug in ('mnhd','madinet-masr'));

  -- A little pipeline, so the employer applicant view is not empty either.
  insert into applications (job_id, candidate_id, status, experience_band, note)
  select j.id, c.candidate, c.status::application_status, c.band::experience_band, c.note
  from jobs j
  join (values
    ('property-consultant-primary-new-cairo-562624', (u->>'candidate3')::uuid, 'new',         'junior_1_3', 'متاح أبدأ فوراً.'),
    ('property-consultant-primary-new-cairo-562624', (u->>'candidate6')::uuid, 'shortlisted', 'fresh_0_1',  null),
    ('property-consultant-primary-new-cairo-562624', (u->>'candidate2')::uuid, 'interview',   'senior_5_plus', 'عندي خبرة في الإيجارات وعايزة أتحول للبيع الأول.'),
    ('sales-consultant-new-capital-814806',          (u->>'candidate6')::uuid, 'new',         'fresh_0_1',  null),
    ('sales-consultant-new-capital-814806',          (u->>'candidate4')::uuid, 'hired',       'senior_5_plus', null),
    ('resale-rentals-agent-sheikh-zayed-925981',     (u->>'candidate3')::uuid, 'new',         'junior_1_3', null),
    ('residential-lettings-agent-maadi-527622',      (u->>'candidate7')::uuid, 'shortlisted', 'mid_3_5',    'شغال دلوقتي في إدارة أملاك وعايز أرجع للإيجارات.')
  ) as c(job_slug, candidate, status, band, note) on j.slug = c.job_slug;

  insert into saved_jobs (candidate_id, job_id)
  select (u->>'candidate1')::uuid, id from jobs
  where slug in ('senior-sales-manager-new-capital-693189', 'property-consultant-6th-of-october-765377');

  raise notice 'demo data inserted';
end $$;
