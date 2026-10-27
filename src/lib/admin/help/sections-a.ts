import { text, type HelpSection } from './types';

const t = text;

/**
 * Access, overview, search, listings, companies.
 * Labels in «» are the words on the screen, from messages/ar.json.
 */
export const SECTIONS_A: HelpSection[] = [
  {
    id: 'access',
    title: t('الوصول وتسجيل الدخول', 'Access and sign-in'),
    lede: t(
      'لوحة الإدارة لا تُفتح إلا لحساب دوره «مدير». من دون ذلك تُعاد إلى الصفحة التي تناسب حسابك.',
      'The admin console opens only for an account whose role is admin. Anyone else is sent to the page their account belongs on.',
    ),
    features: [
      {
        id: 'access-who',
        title: t('من يدخل لوحة الإدارة', 'Who can open the console'),
        summary: t(
          'بعد تسجيل الدخول وإكمال بيانات الحساب، يُرسَل المشرف إلى «نظرة عامة» على المسار /admin. الحسابات الأخرى تذهب إلى لوحة المرشح أو منطقة أصحاب العمل. صفحات /admin كلها تتحقق من الدور قبل أن ترسم شيئًا.',
          'After sign-in and onboarding, an admin is sent to Overview at /admin. Other accounts go to the candidate dashboard or the employer area. Every /admin page checks the role before it draws anything.',
        ),
        href: '/admin',
        steps: [
          t('سجّل الدخول بالبريد وكلمة المرور، أو عبر Google أو Apple، من صفحة «تسجيل الدخول».', 'Sign in with email and password, or with Google or Apple, from Sign in.'),
          t('إن لم يكتمل الحساب بعد، تُكمَل البيانات أولًا ثم تُفتح لوحة الإدارة.', 'If onboarding is not finished, complete it first; the console opens after that.'),
          t('من القائمة الجانبية تحت «الإدارة» تصل إلى كل شاشات هذه الدليل. لا تظهر هذه المجموعة إلا للمشرف.', 'The sidebar group labelled الإدارة lists every screen in this guide. That group is shown only to an admin.'),
        ],
        fields: [
          {
            label: t('الدور', 'Role'),
            detail: t('«مدير» هو ما يفتح اللوحة. تعيينه يتم من صفحة الحساب، لا من التسجيل.', 'Admin is the role that opens the console. It is granted from an account page, not at sign-up.'),
          },
        ],
        statuses: [
          { label: t('مفعّل', 'Approved'), tone: 'success', detail: t('الحساب يعمل.', 'The account can act.') },
          { label: t('تحت المراجعة', 'Pending'), tone: 'warning', detail: t('موقوف عن العمل حتى يُفعَّل. ترقية مشرف لا ترفع هذا الإيقاف.', 'Held until approved. Promoting someone to admin does not lift this.') },
          { label: t('موقوف', 'Suspended'), tone: 'destructive', detail: t('لا يستطيع العمل على المنصة. حسابات المشرفين لا تُوقَف من لوحة الحسابات.', 'Cannot act on the platform. Admin accounts are not suspended from the accounts screen.') },
        ],
        tips: [
          t('حساب أوقفه مشرف لا يرى صفحات العمل: تبقى إعدادات الحساب والإشعارات، ويظهر سبب الإيقاف وإمكانية طلب المراجعة.', 'An account an admin has suspended does not see the working pages. Account settings and notifications stay, with the reason and a way to appeal.'),
          t('المشرف الذي يملك شركة يرى أيضًا منطقة أصحاب العمل. من دون شركة لا تظهر له.', 'An admin who belongs to a company also sees the employer area. Without a company, that area is not shown.'),
        ],
      },
      {
        id: 'access-mfa',
        title: t('التحقق بخطوتين', 'Two-step sign-in'),
        summary: t(
          'إن كان الحساب قد فعّل التحقق بخطوتين، لا تُفتح لوحة الإدارة حتى يُثبَت الرمز في هذه الجلسة. تُحوَّل إلى إعدادات الحساب لإدخال الرمز. إن لم يُفعَّل بعد، تُفتح اللوحة إلا إذا اشترطت المنصة التسجيل عبر المتغير ADMIN_MFA_REQUIRED.',
          'If the account has enrolled two-step sign-in, the console stays closed until this session proves the code. You are sent to account settings to enter it. If you have not enrolled, the console opens unless the platform requires enrolment with ADMIN_MFA_REQUIRED.',
        ),
        href: '/dashboard/account',
        steps: [
          t('من «الحساب» فعّل «التحقق بخطوتين» واتبع تسجيل التطبيق.', 'From Account, turn on Two-step sign-in and finish enrolling the app.'),
          t('في الزيارة التالية، إن طُلب الرمز، أدخله قبل العودة إلى /admin.', 'On the next visit, if the code is asked for, enter it before returning to /admin.'),
        ],
        fields: [
          {
            label: t('ADMIN_MFA_REQUIRED', 'ADMIN_MFA_REQUIRED'),
            detail: t('القيمة true وحدها تُلزم كل مشرف لم يسجّل عاملًا ثانيًا بإعداده قبل فتح اللوحة. أي قيمة أخرى، أو غياب المتغير، لا تطلب التسجيل. من سجّل بالفعل يُطلب منه الرمز في كل الأحوال.', 'Only the value true forces every admin who has not enrolled a second factor to set one up before the console opens. Any other value, or an unset variable, does not ask for enrolment. Someone who already enrolled is still asked for the code.'),
          },
        ],
        tips: [
          t('صفحة الحساب خارج هذا الشرط، حتى لا تدور الإحالة بين الصفحة والتحقق.', 'The account page sits outside this check, so the redirect cannot loop.'),
          t('قاعدة البيانات ترفض جلسة المشرف التي لم تثبت العامل الثاني بعد تسجيله، حتى لو فُتحت صفحة بالعنوان مباشرة.', 'The database refuses an admin session that has not proved the second factor after enrolment, even if a page is opened by its address.'),
        ],
      },
      {
        id: 'access-mail-banner',
        title: t('تنبيه توقف البريد', 'The mail-off notice'),
        summary: t(
          'إن نقصت متغيرات إرسال البريد، يظهر تنبيه أعلى كل صفحة في لوحة الإدارة: «المنصة غير قادرة على إرسال البريد». يذكر أسماء المتغيرات الناقصة فقط، لا قيمها.',
          'If the mail variables are missing, a notice sits at the top of every admin page: “The platform cannot send email.” It names the missing variables and nothing of their values.',
        ),
        steps: [
          t('اقرأ أسماء المتغيرات في التنبيه.', 'Read the variable names in the notice.'),
          t('اضبطها في Vercel ثم أعد النشر. التنبيه يختفي عندما تكتمل.', 'Set them in Vercel and redeploy. The notice goes away once they are set.'),
        ],
        fields: [
          { label: t('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'), detail: t('من دونه لا يُكتب سجل الرسالة.', 'Without it, a message is not even recorded.') },
          { label: t('RESEND_API_KEY', 'RESEND_API_KEY'), detail: t('مفتاح الإرسال.', 'The sending key.') },
          { label: t('RESEND_FROM', 'RESEND_FROM'), detail: t('عنوان المرسِل.', 'The from address.') },
          { label: t('RESEND_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET'), detail: t('يظهر في التنبيه العام. صفحة نشاط البريد تتحقق من الثلاثة الأولى فقط.', 'Shown on the global notice. The email activity page checks the first three only.') },
        ],
        tips: [
          t('قيمة وهمية مثل REPLACE_ME تُحسب ناقصة.', 'A placeholder such as REPLACE_ME counts as missing.'),
        ],
      },
    ],
  },
  {
    id: 'overview',
    title: t('نظرة عامة وطلبات الحذف', 'Overview and deletion requests'),
    lede: t(
      'صفحة «نظرة عامة»: ما ينتظر قرارًا، وحالة المنصة اليوم. أعلى الصفحة بحث يفتح «بحث».',
      'Overview: what is waiting for a decision, and how the platform stands today. The search at the top opens Search.',
    ),
    features: [
      {
        id: 'overview-attention',
        title: t('يحتاج قرارًا', 'Needs a decision'),
        summary: t(
          'صف أرقام، كل رقم رابط إلى الطابور المعني. الصفر لا يُلوَّن؛ الرقم الأكبر من صفر يُبرز حتى يُنجَز العمل.',
          'A row of figures, each a link to the queue it counts. Zero stays quiet; a figure above zero is emphasised until the work is done.',
        ),
        href: '/admin',
        fields: [
          { label: t('في قائمة المراجعة', 'In the review queue'), detail: t('يفتح «الإعلانات» على تبويب الانتظار.', 'Opens Listings on the waiting tab.') },
          { label: t('بانتظار أكثر من يوم', 'Waiting more than a day'), detail: t('من الطابور نفسه، ما انتظر أكثر من يوم.', 'The same queue, the ones that have waited more than a day.') },
          { label: t('بلاغات مفتوحة', 'Open reports'), detail: t('يفتح «البلاغات».', 'Opens Reports.') },
          { label: t('شركات بانتظار التوثيق', 'Companies waiting for verification'), detail: t('يفتح «الشركات» على المستندات المنتظرة.', 'Opens Companies on the documents that are waiting.') },
          { label: t('حسابات بانتظار التفعيل', 'Accounts waiting for approval'), detail: t('يفتح «الحسابات» على «تحت المراجعة».', 'Opens Accounts on Pending.') },
        ],
        tips: [
          t('الشارات على القائمة الجانبية تعدّ الطوابير نفسها: الإعلانات، الشركات، البلاغات، طلبات المراجعة، الحسابات.', 'The badges on the sidebar count the same queues: listings, companies, reports, appeals, accounts.'),
        ],
      },
      {
        id: 'overview-deletion',
        title: t('طلبات حذف حسابات', 'Account deletion requests'),
        summary: t(
          'تظهر فقط عندما يوجد طلب مفتوح. مالكو شركات يريدون المغادرة. حذف الحساب يحذف الشركة وإعلاناتها وطلبات التقديم عليها: اتفق معهم على مصير الشركة، ونفّذه، ثم أغلق الطلب. الإغلاق لا يحذف شيئًا بنفسه.',
          'Shown only while a request is open. Company owners asking to leave. Deleting the account deletes the company, its listings and the applications to them: agree what happens to the company, do that, then close the request. Closing does not delete anything by itself.',
        ),
        href: '/admin',
        steps: [
          t('اقرأ المرجع والتاريخ، وافتح الحساب والشركة من الرابطين.', 'Read the reference and the date, and open the account and the company from the two links.'),
          t('اتفق على مصير الشركة ونفّذ ما اتُّفق عليه خارج هذا الزر.', 'Agree what happens to the company and do it somewhere other than this button.'),
          t('اضغط «أغلق الطلب». لا يُطلب سبب، ولا نافذة تأكيد.', 'Press Close request. No reason is asked, and there is no confirmation dialog.'),
        ],
        fields: [
          { label: t('المرجع', 'Reference'), detail: t('رمز الطلب كما سُجّل.', 'The request’s reference, as recorded.') },
          { label: t('الحساب', 'Account'), detail: t('اسم المالك، أو «حُذف الحساب» إن زال الحساب.', 'The owner’s name, or Account already deleted if the account is gone.') },
          { label: t('الشركة', 'Company'), detail: t('رابط إلى ملف الشركة إن وُجدت.', 'A link to the company file when there is one.') },
        ],
        statuses: [
          { label: t('مفتوح', 'Open'), tone: 'warning', detail: t('ما زال في القائمة. تُعرض حتى خمسين طلبًا، الأقدم أولًا.', 'Still on the list. Up to fifty are shown, oldest first.') },
        ],
        tips: [
          t('«أغلق الطلب» يسجّل من أغلقه. لا يُرسل ردًا إلى صاحب الطلب.', 'Close request records who closed it. No reply is sent to the person who asked.'),
        ],
      },
      {
        id: 'overview-market',
        title: t('حالة السوق والأطراف', 'The market and who is on it'),
        summary: t(
          'قسم «حالة السوق» يعدّ الإعلانات والتقديمات. قسم «الأطراف» يعدّ الشركات والحسابات والملفات. كل رقم يفتح القائمة المصنّفة المناسبة.',
          'Marketplace counts listings and applications. Population counts companies, accounts and profiles. Each figure opens the filtered list it describes.',
        ),
        href: '/admin',
        fields: [
          { label: t('إعلانات منشورة', 'Live listings'), detail: t('المنشور الذي لم تنتهِ مدته. يفتح تبويب «منشورة».', 'Published and not yet past its date. Opens the Live tab.') },
          { label: t('تنتهي خلال أسبوع', 'Expiring within a week'), detail: t('يفتح «تنتهي قريبًا».', 'Opens Expiring soon.') },
          { label: t('منشورة ومن دون متقدمين', 'Live with no applicants'), detail: t('يفتح «من دون متقدمين».', 'Opens No applicants.') },
          { label: t('منتهية', 'Expired'), detail: t('يفتح «منتهية».', 'Opens Expired.') },
          { label: t('تقديمات (7 أيام)', 'Applications (7 days)'), detail: t('يفتح «طلبات التقديم»، ومعه الفرق عن الأيام السبعة السابقة.', 'Opens Applications, with the change against the previous seven days.') },
          { label: t('لم تُفتح منذ أسبوع', 'Unopened for a week'), detail: t('يفتح تبويب «لم تُفتح منذ أسبوع».', 'Opens the Unopened for a week tab.') },
          { label: t('شركات توظّف', 'Companies hiring'), detail: t('يفتح «الشركات» على «الكل».', 'Opens Companies on All.') },
          { label: t('شركات موثّقة', 'Verified companies'), detail: t('يفتح تبويب «موثّقة».', 'Opens the Verified tab.') },
          { label: t('مرشحين', 'Candidates'), detail: t('يفتح الحسابات على دور المرشح.', 'Opens accounts filtered to candidates.') },
          { label: t('حسابات شركات', 'Employer accounts'), detail: t('يفتح الحسابات على دور صاحب العمل.', 'Opens accounts filtered to employers.') },
          { label: t('حسابات جديدة (7 أيام)', 'New accounts (7 days)'), detail: t('يفتح «الحسابات».', 'Opens Accounts.') },
          { label: t('ملفات ظاهرة في الدليل', 'Profiles visible in the directory'), detail: t('يفتح «دليل الاستشاريين» في الإدارة، ويظهر بجانبه العدد المخفي بصيغة «+١٢ مخفي».', 'Opens the admin consultant directory, with the hidden count written as “+12 hidden”.') },
          { label: t('حسابات موقوفة', 'Suspended accounts'), detail: t('يفتح «موقوف».', 'Opens Suspended.') },
          { label: t('شركات موقوفة', 'Suspended companies'), detail: t('يفتح تبويب الإيقاف في الشركات.', 'Opens the suspended tab under Companies.') },
          { label: t('ملفات استشارية مقيّدة', 'Restricted consultant profiles'), detail: t('يفتح الدليل على «مقيّد».', 'Opens the directory on Restricted.') },
        ],
        tips: [
          t('«منشورة» هنا تعني التاريخ: الإعلان ما زال داخل مدته، لا مجرد كلمة الحالة.', 'Live here means the date: the listing is still inside its window, not only the word on its badge.'),
        ],
      },
      {
        id: 'overview-activity',
        title: t('النشاط وآخر القرارات', 'Activity and recent decisions'),
        summary: t(
          'إن وُجدت بيانات، يظهر رسم «نشاط المنصة خلال 30 يوم» للتقديمات والإعلانات المنشورة والحسابات الجديدة. تحته «آخر القرارات»، ورابط «سجل القرارات».',
          'When the figures exist, a chart titled Platform activity over 30 days shows applications, published listings and new accounts. Under it, Recent decisions, and a link to the audit log.',
        ),
        href: '/admin/audit',
        fields: [
          { label: t('التقديمات', 'Applications'), detail: t('سلسلة في الرسم.', 'One series on the chart.') },
          { label: t('إعلانات نُشرت', 'Listings published'), detail: t('سلسلة في الرسم.', 'One series on the chart.') },
          { label: t('حسابات جديدة', 'New accounts'), detail: t('سلسلة في الرسم.', 'One series on the chart.') },
        ],
        statuses: [
          { label: t('لا نشاط خلال آخر 30 يومًا', 'No activity in the last 30 days'), tone: 'outline' },
          { label: t('لا توجد قرارات أو ملاحظات مسجّلة بعد', 'No decisions or notes recorded yet'), tone: 'outline' },
        ],
        tips: [
          t('إن غاب اسم صاحب القرار يظهر «مشرف سابق».', 'If the person who decided is gone, the row says Former admin.'),
        ],
      },
    ],
  },
  {
    id: 'search',
    title: t('البحث العام', 'Global search'),
    lede: t(
      '«بحث»: ابحث عن أي حساب أو شركة أو إعلان أو طلب تقديم. النتائج مجموعات قصيرة، لا دليلًا كاملًا.',
      'Search: find any account, company, listing or application. Results are short groups, not a full directory.',
    ),
    features: [
      {
        id: 'search-box',
        title: t('صندوق البحث والنتائج', 'The search box and its results'),
        summary: t(
          'ابحث بالاسم أو العنوان كجزء، أو بالبريد كاملًا، أو برقم الهاتف، أو بالرمز. أقل من حرفين لا يُبحث. لكل نوع ست نتائج على الأكثر؛ للقوائم الأطول استخدم صفحة ذلك النوع.',
          'Search a name or title by a fragment, or an email in full, or a phone number, or an id. Fewer than two characters is not searched. Each kind returns at most six rows; for a longer list, use that kind’s own page.',
        ),
        href: '/admin/search',
        steps: [
          t('من «نظرة عامة» أو من «بحث» اكتب في «اسم، بريد، رقم هاتف، عنوان إعلان أو رمز…» ثم «بحث».', 'From Overview or Search, type in “Name, email, phone, listing title or id…” and press Search.'),
          t('اختر صفًا. يفتح ملفه في الإدارة.', 'Choose a row. It opens that record in the console.'),
        ],
        fields: [
          { label: t('حسابات', 'Accounts'), detail: t('الاسم بجزء منه، أو البريد أو الهاتف أو الرمز كاملًا. الشارة حالة الموافقة.', 'Name by fragment, or email, phone or id in full. The badge is the approval state.') },
          { label: t('شركات', 'Companies'), detail: t('الاسم. الشارة التوثيق، أو «موقوفة».', 'The name. The badge is verification, or Suspended.') },
          { label: t('إعلانات', 'Listings'), detail: t('العنوان. الشارة حالة الإعلان.', 'The title. The badge is the listing’s status.') },
          { label: t('ملفات الاستشاريين', 'Consultant profiles'), detail: t('الاسم. الشارة الظهور، أو «مقيّد».', 'The name. The badge is visibility, or Restricted.') },
          { label: t('طلبات تقديم', 'Applications'), detail: t('ما يطابق الطلب. الشارة مرحلة الطلب.', 'Whatever matched the application. The badge is its stage.') },
        ],
        statuses: [
          { label: t('اكتب حرفين على الأقل', 'Type at least two characters'), tone: 'warning' },
          { label: t('لا توجد نتائج', 'Nothing found'), tone: 'outline', detail: t('جرّب جزءًا من الاسم، أو البريد كاملًا، أو الرمز.', 'Try part of the name, the full email, or the id.') },
        ],
        tips: [
          t('البريد ورقم الهاتف لا يظهران في قوائم الحسابات. هنا تصل إلى الملف، وبيانات التواصل تُطلب من صفحة الحساب بسبب مكتوب.', 'Email and phone are not shown on the accounts list. Search takes you to the file; contact details are asked for on the account page, with a written reason.'),
        ],
      },
    ],
  },
  {
    id: 'listings',
    title: t('مراجعة الإعلانات', 'Listings moderation'),
    lede: t(
      '«الإعلانات»: كل الإعلانات حسب مرحلتها — وما ينتظر مراجعة أولًا، الأقدم أولًا. لا يُنشر شيء بضغطة واحدة؛ كل قرار نافذة تأكيد.',
      'Listings: every listing by stage — the review queue first, oldest first. Nothing publishes on one click; every decision is a confirmation.',
    ),
    features: [
      {
        id: 'listings-queue',
        title: t('طابور الإعلانات', 'The listings queue'),
        summary: t(
          'التبويبات تصنّف الإعلانات. البحث في «عنوان الإعلان، الرابط، أو الرمز…». يمكن حصر القائمة بشركة واحدة عبر عنوان الصفحة. الصفحة خمسة وعشرون صفًا.',
          'The tabs sort listings. Search is “Listing title, link, or id…”. The address can limit the list to one company. A page is twenty-five rows.',
        ),
        href: '/admin/jobs',
        fields: [
          { label: t('الإعلان', 'Listing'), detail: t('العنوان، والصف يفتح التفاصيل.', 'The title; the row opens the detail.') },
          { label: t('الشركة', 'Company'), detail: t('اسمها، و«موقوفة» إن كانت موقوفة.', 'Its name, and Suspended when it is.') },
          { label: t('بانتظار', 'Waiting'), detail: t('في طابور المراجعة: منذ متى، وبالأحمر إن بلغ يومًا.', 'On the review queue: how long, in red once it reaches a day.') },
          { label: t('ينتهي في', 'Expires'), detail: t('في تبويب ما ينتهي قريبًا.', 'On the expiring tab.') },
          { label: t('التاريخ', 'Date'), detail: t('في باقي التبويبات: النشر أو الإنشاء.', 'On the other tabs: published or created.') },
          { label: t('متقدمين', 'Applicants'), detail: t('العدد.', 'The count.') },
          { label: t('الحالة', 'Status'), detail: t('شارة الإعلان، و«ممول» إن كان مميزًا، وعدد البلاغات والعلامات.', 'The listing badge, Sponsored when it is featured, plus report and flag counts.') },
        ],
        statuses: [
          { label: t('الكل', 'All'), tone: 'outline', detail: t('الافتراضي. الأحدث أولًا.', 'The default. Newest first.') },
          { label: t('بانتظار المراجعة', 'Waiting for review'), tone: 'warning', detail: t('طابور العمل، والأقدم أولًا. الشارة في القائمة الجانبية تفتحه.', 'The work queue, oldest first. The sidebar badge opens it.') },
          { label: t('عليها علامات', 'Flagged'), tone: 'destructive', detail: t('من طابور الانتظار، وفي النص نمط يستحق نظرة أقرب: مال، أو بطاقة أو بنك، أو رابط مموّه. العلامة ليست حكمًا.', 'From the waiting queue, where the text has a pattern worth a closer look: money, an identity or bank detail, or a disguised link. A flag is not a verdict.') },
          { label: t('منشورة', 'Live'), tone: 'success', detail: t('نشطة ولم ينتهِ تاريخها.', 'Active and not past its date.') },
          { label: t('تنتهي قريبًا', 'Expiring soon'), tone: 'warning', detail: t('نشطة وتنتهي خلال سبعة أيام.', 'Active and expiring within seven days.') },
          { label: t('من دون متقدمين', 'No applicants'), tone: 'accent', detail: t('منشورة منذ أكثر من ثلاثة أيام ولم يتقدّم أحد.', 'Live for more than three days with nobody applied.') },
          { label: t('عليها بلاغات', 'Reported'), tone: 'destructive', detail: t('بلاغ مفتوح أو تحت التحقيق.', 'A report that is open or under investigation.') },
          { label: t('منتهية', 'Expired'), tone: 'outline' },
          { label: t('مغلقة', 'Closed'), tone: 'outline' },
          { label: t('مرفوضة', 'Rejected'), tone: 'destructive' },
          { label: t('مسودات', 'Drafts'), tone: 'default' },
        ],
        tips: [
          t('في «من دون متقدمين» تظهر الجملة: منشورة منذ أكثر من ثلاثة أيام ولم يتقدّم أحد — غالبًا تحتاج تعديلًا أو المحتوى غير واضح.', 'On No applicants the page says: live for more than three days with nobody applied — it usually needs an edit, or the content is unclear.'),
          t('القائمة الفارغة من دون بحث تقول «لا شيء بانتظارك». مع بحث بلا نتائج تقول «لا توجد نتائج».', 'An empty list with no search says Nothing is waiting. A search with no rows says Nothing found.'),
        ],
      },
      {
        id: 'listings-detail',
        title: t('قراءة إعلان', 'Reading a listing'),
        summary: t(
          'صفحة الإعلان تعرض ما ستراه على الموقع، وطلبات التقديم، والبلاغات، والسجل. الوصف الكامل يُفتح وحده عندما يكون الإعلان بانتظار المراجعة.',
          'The listing page shows what the site will show, the applications, the reports and the record. The full description opens by itself while the listing is waiting for review.',
        ),
        href: '/admin/jobs',
        fields: [
          { label: t('المجال', 'Track'), detail: t('تخصص الإعلان.', 'The listing’s specialism.') },
          { label: t('نوع التوظيف', 'Employment type'), detail: t('دوام أو ما سجّلته الشركة.', 'Full-time or whatever the company recorded.') },
          { label: t('الخبرة', 'Experience'), detail: t('شريحة الخبرة.', 'The experience band.') },
          { label: t('المنطقة', 'District'), detail: t('منطقة الإعلان.', 'The listing’s district.') },
          { label: t('الراتب الأساسي', 'Basic salary'), detail: t('بالجنيه، أو أنه غير معلن.', 'In pounds, or that none was stated.') },
          { label: t('العمولة', 'Commission'), detail: t('نسبتها أو نوعها.', 'Its rate or its type.') },
          { label: t('العملاء', 'Leads'), detail: t('من يجلب العملاء.', 'Who brings the leads.') },
          { label: t('الوظائف الخالية', 'Open seats'), detail: t('العدد المعلن.', 'The number stated.') },
          { label: t('أُنشئ / نُشر / ينتهي في / المشاهدات', 'Created / Published / Expires / Views'), detail: t('تواريخ الإعلان وعدد المشاهدات.', 'The listing’s dates and its view count.') },
          { label: t('الصفحة العامة', 'Public page'), detail: t('رابط الموقع، إلا إن كان الإعلان مسودة.', 'The public link, unless the listing is a draft.') },
        ],
        tips: [
          t('«طلبات التقديم» هنا أعداد حسب المرحلة، و«عرض الكل» يفتح طلبات هذا الإعلان.', 'Applications here are counts by stage, and See all opens this listing’s applications.'),
          t('إن رُفض الإعلان تظهر «الملاحظة التي وصلت إلى الشركة».', 'If the listing was rejected, the page shows The note the company received.'),
        ],
      },
      {
        id: 'listings-review',
        title: t('مراجعة إعلان منتظر', 'Reviewing a listing that is waiting'),
        summary: t(
          'ما دام الإعلان «قيد المراجعة» تظهر ثلاثة إجراءات تحت «المراجعة»: «اعتماد»، و«اطلب تعديل»، و«رفض». الاعتماد بلا سبب. التعديل والرفض يحتاجان ملاحظة تصل إلى الشركة، من ثلاثة أحرف على الأقل.',
          'While a listing is In review, three actions sit under Moderation: Approve, Request changes, and Reject. Approval needs no reason. Changes and rejection need a note that reaches the company, at least three characters.',
        ),
        steps: [
          t('اقرأ الوصف والعلامات في «أمور تستحق نظرة».', 'Read the description and the lines under What to look at.'),
          t('اضغط الإجراء واقرأ نص النافذة قبل التأكيد.', 'Press the action and read the dialog before confirming.'),
          t('في «اطلب تعديل» أو «رفض» اكتب «الملاحظة (تصل إلى الشركة)».', 'For Request changes or Reject, write The note (sent to the company).'),
          t('بعد الاعتماد أو الرفض تنتقل الصفحة إلى الإعلان التالي بانتظار المراجعة، وتقول «تمت الموافقة — الانتقال للتالي». إن لم يبقَ شيء: «لا توجد إعلانات أخرى بانتظار المراجعة».', 'After approval or rejection the page moves to the next listing waiting for review, and says Approved — moving to the next. When none remain: No other listings are waiting for review.'),
        ],
        fields: [
          { label: t('اعتماد', 'Approve'), detail: t('«نشر الإعلان»: يظهر على الموقع فورًا لمدة ثلاثين يومًا، ويصل الشركة بريد. يُطبَّق حد الإعلان الواحد للشركات غير الموثّقة، والرصيد إن كان النشر يخصم منه.', 'Publish the listing: it appears on the site at once for thirty days, and the company is emailed. The one-listing limit for an unverified company applies, and credits apply when publishing spends one.') },
          { label: t('اطلب تعديل', 'Request changes'), detail: t('يعود الإعلان إلى الشركة مع ملاحظتك، وتستطيع تعديله وإرساله مرة أخرى.', 'The listing goes back to the company with your note. They can edit it and send it again.') },
          { label: t('رفض', 'Reject'), detail: t('لن يُنشر الإعلان، ويصل الشركة السبب.', 'The listing will not be published, and the company receives the reason.') },
        ],
        tips: [
          t('إن تغيّر الإعلان بعد فتح الصفحة يقول الخطأ «تغيّر هذا بعد فتح الصفحة» وتُعرض النسخة الحالية. اقرأها قبل أن تعيد.', 'If the listing changed after you opened the page, the error says it changed and shows the current copy. Read it before trying again.'),
          t('«هذه الشركة غير موثّقة ولديها إعلان فعّال بالفعل» أو «نفد رصيد إعلانات هذه الشركة» يمنعان النشر حتى يُعالج السبب.', '“This company is unverified and already has a live listing” or “This company has no post credits left” blocks publishing until that is dealt with.'),
        ],
      },
      {
        id: 'listings-after',
        title: t('إعلان منشور أو منتهٍ أو مرفوض أو مغلق', 'A live, expired, rejected or closed listing'),
        summary: t(
          'الإجراءات تتبع الحالة. المسودة لا تُنشر من هنا. ما أغلقته الشركة لا يُعاد فتحه من هنا.',
          'The actions follow the state. A draft is not published from here. What the company closed is not reopened from here.',
        ),
        fields: [
          { label: t('أنزل الإعلان', 'Take down'), detail: t('للمنشور. يختفي فورًا، ويصل الشركة السبب. الطلبات التي قُدّمت تبقى عند الشركة.', 'For a live listing. It disappears at once, and the company receives the reason. Applications already sent stay with the company.') },
          { label: t('أغلق الإعلان', 'Close the listing'), detail: t('للمنشور أو المنتهي، بالنيابة عن الشركة — مثلًا إن طلبت ذلك من الدعم. لا يُرسل بريد رفض. تستطيع الشركة إعادة نشره بنفسها بعد ذلك.', 'For a live or expired listing, on the company’s behalf — for example if support was asked. No rejection email is sent. The company can publish it again itself afterwards.') },
          { label: t('استعادة الإعلان', 'Restore the listing'), detail: t('للمرفوض. يعود منشورًا. إن انتهت فترته تبدأ ثلاثون يومًا جديدة ويُخصم رصيد إن كان الرصيد مطلوبًا. حد الإعلان الواحد ما زال ساريًا.', 'For a rejected listing. It goes live again. If its window had ended, a new thirty days start and a credit is spent when credits apply. The one-listing limit still applies.') },
        ],
        statuses: [
          { label: t('مسودة الشركة', 'The company’s draft'), tone: 'default', detail: t('«مسودة الشركة — لا تُنشر إلا عندما ترسلها الشركة للمراجعة.»', '“The company’s draft — it is not published until the company sends it for review.”') },
          { label: t('أغلقته الشركة', 'Closed by the company'), tone: 'outline', detail: t('«أغلقته الشركة. إعادة النشر قرارها.»', '“The company closed it. Publishing again is their decision.”') },
        ],
        tips: [
          t('كل هذه الإجراءات ما عدا الاستعادة تطلب سببًا. الإغلاق والتنزيل والاستعادة تمر بنافذة تأكيد.', 'All of these except restore ask for a reason. Close, take down and restore each open a confirmation.'),
        ],
      },
      {
        id: 'listings-feature',
        title: t('تمييز الإعلان', 'Featuring a listing'),
        summary: t(
          '«تمييز الإعلان» يثبت الإعلان في أول الموقع أربعة عشر يومًا، وعليه علامة «إعلان ممول». يظهر الزر ما دام الإعلان منشورًا داخل مدته. «إلغاء التمييز» يرفعه. لا يُطلب سبب.',
          'Feature pins the listing to the top of the site for fourteen days, with a Sponsored mark. The button is there while the listing is live inside its dates. Remove feature takes it off. No reason is asked.',
        ),
        href: '/admin/jobs',
        steps: [
          t('افتح إعلانًا منشورًا لم تنتهِ مدته.', 'Open a listing that is live and not past its date.'),
          t('من «المراجعة» اضغط «تمييز الإعلان» وأكّد.', 'Under Moderation, press Feature and confirm.'),
        ],
        statuses: [
          { label: t('ممول', 'Sponsored'), tone: 'primary', detail: t('يظهر على الصف وفي أول الموقع طوال مدة التمييز.', 'Shown on the row and at the top of the site for the feature window.') },
        ],
      },
      {
        id: 'listings-safety',
        title: t('علامات النص والملاحظات', 'Text flags and notes'),
        summary: t(
          '«أمور تستحق نظرة» تعرض ما في النص وما في سجل الشركة. لا شيء منها يقرر مكانك؛ القرار زر تأكيده أنت. «السجل والملاحظات» يحفظ ملاحظة داخلية لا تُعدَّل ولا تُحذف ولا يراها غير المشرفين.',
          'What to look at shows what is in the text and what is in the company’s history. None of it decides for you; the decision is a button you confirm. Record and notes keeps an internal note that cannot be edited or deleted, and that nobody but admins can read.',
        ),
        fields: [
          { label: t('يذكر مالًا مطلوبًا من المتقدم', 'Mentions money asked of the applicant'), detail: t('علامة في النص.', 'A flag in the text.') },
          { label: t('يطلب بيانات بطاقة أو بنك أو دخول', 'Asks for card, bank or login details'), detail: t('علامة في النص.', 'A flag in the text.') },
          { label: t('رابط مختصر أو تليجرام أو نموذج أو واتساب', 'A shortened, Telegram, form or WhatsApp link'), detail: t('روابط تُذكر بنوعها.', 'Links, named by their kind.') },
          { label: t('رقم هاتف أو بريد في النص', 'A phone or email in the text'), detail: t('علامة في النص.', 'A flag in the text.') },
          { label: t('إشارات الشركة', 'Company signals'), detail: t('نشر كثيف، أو رفض سابق، أو تكرار، أو بلاغات، أو رقم أو موقع مشترك مع شركة أخرى أو حساب موقوف.', 'Heavy posting, earlier rejections, copies, reports, or a phone or website shared with another company or a suspended account.') },
          { label: t('أضف ملاحظة', 'Add a note'), detail: t('حتى ألفين حرف. «ما عرفته في التحقيق — للمشرفين فقط…».', 'Up to two thousand characters. “What you learned in the investigation — admins only…”.') },
        ],
        tips: [
          t('«لا شيء لافت في النص نفسه» و«لا توجد إشارات للمراجعة» تعنيان أن الفحص لم يجد ما يُذكر، لا أن الإعلان سليم.', '“Nothing stands out in the text” and “No signals to review” mean the check found nothing to show, not that the listing is fine.'),
        ],
      },
    ],
  },
  {
    id: 'companies',
    title: t('توثيق الشركات', 'Company verification'),
    lede: t(
      '«الشركات» تفتح على «الكل». طابور المستندات المنتظرة تبويب، والأقدم أولًا.',
      'Companies opens on All. Documents waiting for review are a tab, oldest first.',
    ),
    features: [
      {
        id: 'companies-queue',
        title: t('قائمة الشركات', 'The companies list'),
        summary: t(
          'ابحث في «اسم الشركة بالعربي أو الإنجليزي، أو الرابط…». طابور الانتظار هو الشركات ذات مستندات قيد المراجعة، الأقدم أولًا. باقي التبويبات الأحدث أولًا. الصفحة خمسة وعشرون صفًا.',
          'Search is “Company name in Arabic or English, or the link…”. The waiting queue is companies with documents in review, oldest first. The other tabs are newest first. A page is twenty-five rows.',
        ),
        href: '/admin/companies',
        fields: [
          { label: t('الاسم', 'Name'), detail: t('اسم الشركة وشعارها.', 'The company name and its logo.') },
          { label: t('الإعلانات', 'Listings'), detail: t('عددها.', 'How many.') },
          { label: t('الفريق', 'Team'), detail: t('عدد الأعضاء.', 'How many members.') },
          { label: t('انضم', 'Joined'), detail: t('تاريخ إنشاء الشركة.', 'When the company was created.') },
          { label: t('الحالة', 'Status'), detail: t('شارة التوثيق، و«موقوفة» إن وُجد إيقاف.', 'The verification badge, and Suspended when a suspension is in place.') },
        ],
        statuses: [
          { label: t('الكل', 'All'), tone: 'outline', detail: t('الافتراضي.', 'The default.') },
          { label: t('مستنداتها قيد المراجعة', 'Documents in review'), tone: 'warning', detail: t('طابور الانتظار، والأقدم أولًا.', 'The waiting queue, oldest first.') },
          { label: t('موثّقة', 'Verified'), tone: 'success' },
          { label: t('غير موثّقة', 'Unverified'), tone: 'outline' },
          { label: t('التوثيق مرفوض', 'Verification rejected'), tone: 'destructive' },
          { label: t('موقوفة', 'Suspended'), tone: 'destructive', detail: t('إيقاف الشركة، وهو غير حالة التوثيق.', 'The company’s suspension, which is separate from verification.') },
        ],
      },
      {
        id: 'companies-file',
        title: t('ملف الشركة والمستندات', 'The company file and its documents'),
        summary: t(
          'الصفحة تجمع بيانات الشركة، ومستندات التوثيق، والفريق، والإعلانات، والبلاغات، والسجل. المستند لا يُعرض رابطًا في الصفحة: «عرض المستند» يفتحه في لسان جديد لخمس دقائق، ويُسجَّل أنك فتحته.',
          'The page gathers the company details, verification documents, team, listings, reports and the record. A document is not a link on the page: View document opens it in a new tab for five minutes, and records that you opened it.',
        ),
        href: '/admin/companies',
        fields: [
          { label: t('الاسم بالعربي / بالإنجليزي', 'Name in Arabic / in English'), detail: t('الاسمان كما سجّلتهما الشركة.', 'The two names as the company wrote them.') },
          { label: t('نوع الشركة', 'Company type'), detail: t('التصنيف الثابت.', 'The fixed classification.') },
          { label: t('المنطقة', 'District'), detail: t('منطقة الشركة.', 'The company’s district.') },
          { label: t('الموقع', 'Website'), detail: t('رابطها إن وُجد.', 'Its link, when it has one.') },
          { label: t('رصيد الإعلانات', 'Post credits'), detail: t('من صفحة الفواتير، كما هو مسجّل.', 'From billing, as recorded.') },
          { label: t('وُثّقت', 'Verified on'), detail: t('تاريخ العلامة.', 'The date of the mark.') },
          { label: t('السجل التجاري / البطاقة الضريبية', 'Commercial register / tax card'), detail: t('نوع المستند وحالته وملاحظة المراجعة إن وُجدت.', 'The document’s kind, its state, and the review note when there is one.') },
          { label: t('الفريق', 'Team'), detail: t('كل عضو يفتح حسابه، مع «مدير» أو «مسؤول توظيف»، و«المالك»، وحالة الحساب.', 'Each member opens their account, with Admin or Recruiter, Owner, and the account’s state.') },
        ],
        tips: [
          t('إن مُنع اللسان الجديد يظهر «افتح المستند».', 'If the new tab is blocked, Open the document is offered.'),
          t('«بلاغات عن الشركة» حتى خمسين بلاغًا، و«الإعلانات» حتى عشرين، مع رابط إن كان على إعلاناتها بلاغ مفتوح.', 'Reports about the company show up to fifty, and Listings up to twenty, with a link when an open report sits on one of its listings.'),
        ],
      },
      {
        id: 'companies-verify',
        title: t('قرارات التوثيق', 'Verification decisions'),
        summary: t(
          'تحت «التوثيق» تتغيّر الأزرار حسب الحالة. التوثيق يضع العلامة ويُعلم الشركة. الرفض يبقيها غير موثّقة ومحدودة بإعلان واحد. سحب التوثيق يزيل العلامة ولا ينزل الإعلانات المنشورة.',
          'Under Verification the buttons follow the state. Verifying sets the mark and tells the company. Rejection leaves it unverified and limited to one listing. Revoking removes the mark and does not take down listings already published.',
        ),
        steps: [
          t('افتح المستندات من «عرض المستند» قبل القرار.', 'Open the documents with View document before deciding.'),
          t('اختر الإجراء المناسب للحالة الظاهرة.', 'Choose the action that matches the state on screen.'),
          t('إن طُلبت «الملاحظة (تصل إلى الشركة)» فاكتبها لها، لا لنفسك.', 'If The note (sent to the company) is asked for, write it for them, not for yourself.'),
        ],
        fields: [
          { label: t('توثيق', 'Verify'), detail: t('ما دامت غير موثّقة. إن وُجدت مستندات منتظرة تُعلَّم بأنها رُوجعت. إن لم تُرفع مستندات يقول النص أن توثّقها فقط إذا تأكدت بطريقة أخرى، وأن تكتب كيف. الملاحظة اختيارية.', 'While it is not verified. Pending documents are marked reviewed. If none were uploaded, the text says to verify only when you have checked another way, and to write how. The note is optional.') },
          { label: t('اطلب تعديل', 'Request changes'), detail: t('في حالة «مستنداتها قيد المراجعة». تعود المستندات إلى الشركة مع ملاحظتك. السبب مطلوب.', 'While documents are in review. The documents go back to the company with your note. A reason is required.') },
          { label: t('رفض', 'Reject'), detail: t('في الانتظار أو غير الموثّقة. تبقى غير موثّقة ومحدودة بإعلان واحد، ويصلها السبب. السبب مطلوب.', 'While pending or unverified. It stays unverified and limited to one listing, and receives the reason. A reason is required.') },
          { label: t('سحب التوثيق', 'Revoke verification'), detail: t('للموثّقة. تُزال العلامة وتعود إلى حد الإعلان الواحد للإعلانات الجديدة. المنشورة حاليًا لا تتأثر. السبب مطلوب.', 'For a verified company. The mark goes and new listings return to the one-listing limit. Listings already published are not affected. A reason is required.') },
        ],
        statuses: [
          { label: t('غير موثّقة', 'Unverified'), tone: 'outline' },
          { label: t('مستنداتها قيد المراجعة', 'Documents in review'), tone: 'warning' },
          { label: t('موثّقة', 'Verified'), tone: 'success' },
          { label: t('التوثيق مرفوض', 'Verification rejected'), tone: 'destructive' },
        ],
      },
      {
        id: 'companies-suspend',
        title: t('إيقاف الشركة', 'Suspending a company'),
        summary: t(
          '«الإيقاف» للشركة التي هي نفسها المشكلة، لا لموظف واحد. الإيقاف ينزّل فورًا كل إعلاناتها المنشورة والمنتظرة، ويمنع إعلانات جديدة حتى يُرفع. السبب يصل إلى أعضاء الشركة. رفع الإيقاف لا يعيد الإعلانات؛ يُعاد كل إعلان من صفحته.',
          'Suspension is for a company that is itself the problem, not for one employee. Suspending immediately takes down every live and waiting listing, and blocks new ones until it is lifted. The reason reaches the company’s members. Lifting the suspension does not restore listings; each one is restored from its own page.',
        ),
        href: '/admin/companies',
        steps: [
          t('من «الإيقاف» اضغط «أوقف الشركة».', 'Under Suspension, press Suspend the company.'),
          t('اكتب «الملاحظة (تصل إلى الشركة)». ثلاثة أحرف على الأقل.', 'Write The note (sent to the company). At least three characters.'),
          t('أكّد. للرفع لاحقًا: «ارفع الإيقاف»، والسبب مطلوب أيضًا.', 'Confirm. To lift it later: Lift the suspension, and a reason is required there too.'),
        ],
        statuses: [
          { label: t('موقوفة', 'Suspended'), tone: 'destructive', detail: t('لافتة بتاريخ الإيقاف والسبب إن سُجّل.', 'A banner with the date and the reason when one was recorded.') },
        ],
        tips: [
          t('المتقدمون يرون أن الشركة موقوفة فقط، لا نص السبب.', 'Applicants see only that the company is suspended, not the text of the reason.'),
          t('إيقاف حساب الموظف من صفحة الحسابات مختلف: إعلانات الشركة تُغلق فقط إذا لم يبقَ زميل بحساب نشط.', 'Suspending an employee from Accounts is different: the company’s listings come down only when no colleague with an active account remains.'),
        ],
      },
    ],
  },
];
