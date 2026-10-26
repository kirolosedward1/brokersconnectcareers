import { text, type HelpSection } from './types';

const t = text;

/** Taxonomy, email, background work, security, and the messages the console shows. */
export const SECTIONS_C: HelpSection[] = [
  {
    id: 'taxonomy',
    title: t('التصنيفات', 'Taxonomy'),
    lede: t(
      '«التصنيفات»: المناطق والمحافظات والمطوّرون. يظهر التعديل على الموقع فورًا، والحذف مسموح فقط لما ليس مستخدمًا.',
      'Taxonomy: districts, governorates and developers. A change appears on the site at once, and deletion is allowed only for what is unused.',
    ),
    features: [
      {
        id: 'taxonomy-places',
        title: t('المناطق والمحافظات والمطوّرون', 'Districts, governorates and developers'),
        summary: t(
          'ثلاثة تبويبات تُحرَّر: «المناطق»، «المحافظات»، «المطوّرين». الاسم العربي والإنجليزي حتى ثمانين حرفًا. الرابط يُكتب عند الإضافة فقط، بحروف إنجليزية صغيرة وأرقام وشرطة، وحتى ستين حرفًا، ثم لا يتغيّر.',
          'Three tabs are edited: Districts, Governorates, Developers. The Arabic and English names are up to eighty characters. The slug is written only when adding, in lowercase Latin letters, digits and hyphens, up to sixty characters, and then it does not change.',
        ),
        href: '/admin/taxonomy',
        steps: [
          t('اختر التبويب. المناطق هي الافتراضي.', 'Choose the tab. Districts is the default.'),
          t('للإضافة: «الاسم بالعربي»، «الاسم بالإنجليزي»، «الرابط: new-cairo»، وللمنطقة «المحافظة»، ثم «إضافة».', 'To add: Name in Arabic, Name in English, the link such as new-cairo, and for a district the Governorate, then Add.'),
          t('لتعديل اسم موجود: غيّر الاسمين واضغط «احفظ الاسم». الرابط تحت الاسم للقراءة.', 'To rename: change the two names and press Save the name. The slug under the name is read-only.'),
          t('«امسح» يظهر فقط عندما يكون الاستخدام صفرًا. أكّد «مسح «الاسم»». الحذف نهائي.', 'Delete is shown only when usage is zero. Confirm Delete “name”. Deletion is final.'),
        ],
        fields: [
          { label: t('المحافظة', 'Governorate'), detail: t('مطلوبة عند إضافة منطقة، وتُختار من المحافظات الموجودة.', 'Required when adding a district, and chosen from the governorates that exist.') },
          { label: t('مستخدم', 'In use'), detail: t('عدد الإعلانات أو الشركات أو الملفات التي تشير إليه. ما دام أكبر من صفر لا يُمسح.', 'How many listings, companies or profiles point at it. While that is above zero it cannot be deleted.') },
          { label: t('لا يتغيّر الرابط بعد الإضافة', 'The link does not change after it is added'), detail: t('الرابط جزء من عناوين الصفحات.', 'The slug is part of public addresses.') },
        ],
        statuses: [
          { label: t('مستخدم في إعلانات أو ملفات', 'In use by listings or profiles'), tone: 'warning', detail: t('«مستخدم في إعلانات أو ملفات، وحذفه يفسدها. غيّر الاسم بدل الحذف.»', '“It is in use by listings or profiles, and deleting it would break them. Rename it instead.”') },
          { label: t('هذا الرابط مستخدم من قبل', 'That slug is already taken'), tone: 'destructive' },
          { label: t('اختر محافظة موجودة', 'Choose an existing governorate'), tone: 'warning' },
        ],
        tips: [
          t('التعديل يمسح النسخة المخبأة للتصنيفات حتى يظهر الاسم الجديد في النشر والبحث فورًا.', 'Saving clears the cached taxonomy so the new name shows in posting and search at once.'),
        ],
      },
      {
        id: 'taxonomy-fixed',
        title: t('القوائم الثابتة', 'Fixed lists'),
        summary: t(
          'تبويب «القوائم الثابتة» للقراءة فقط: المجال، والخبرة، ونوع التوظيف، ونوع الشركة. هذه القوائم ثابتة في البرنامج وقاعدة البيانات. تغييرها يحتاج تحديثًا للنظام، لا زرًا هنا، حتى لا تفسد الإعلانات المصنّفة تحتها.',
          'The Fixed lists tab is read-only: track, experience, employment type and company type. These lists are fixed in the program and the database. Changing them needs a system update, not a button here, so listings already classified under them are not broken.',
        ),
        href: '/admin/taxonomy?kind=fixed',
        tips: [
          t('لا يوجد في هذا التبويب إضافة ولا تعديل ولا حذف.', 'This tab has no add, no rename and no delete.'),
        ],
      },
    ],
  },
  {
    id: 'email',
    title: t('نشاط البريد', 'Email activity'),
    lede: t(
      '«نشاط البريد»: كل رسالة أُرسلت من المنصة، وما حدث لها. لا يُعرض نص الرسالة.',
      'Email activity: every message the platform sent, and what happened to it. The message body is not shown.',
    ),
    features: [
      {
        id: 'email-log',
        title: t('سجل الرسائل', 'The message log'),
        summary: t(
          'التبويبات تصفّي الحالة. القائمة حتى مئتي رسالة. أسفل الصفحة: «تستطيع رؤية شكل كل القوالب من» رابط معاينة القوالب.',
          'The tabs filter by status. The list is up to two hundred messages. At the bottom: You can see the shape of every template from the template preview link.',
        ),
        href: '/admin/email',
        fields: [
          { label: t('المستلم', 'Recipient'), detail: t('العنوان، وتاريخ إنشاء السجل.', 'The address, and when the row was created.') },
          { label: t('القالب', 'Template'), detail: t('اسم القالب ونوع الكيان إن وُجد.', 'The template name and the entity type when there is one.') },
          { label: t('الحالة', 'Status'), detail: t('شارة الحالة. إن تكررت المحاولة يظهر العدد حتى خمس.', 'The status badge. If it was tried more than once, the count is shown, up to five.') },
          { label: t('أُرسلت', 'Sent'), detail: t('وقت الإرسال.', 'When it was sent.') },
          { label: t('سُلّمت', 'Delivered'), detail: t('وقت التسليم إن وصل.', 'When it was delivered, if it was.') },
          { label: t('السبب', 'Reason'), detail: t('نص الخطأ إن فشلت أو ارتدّت.', 'The error text when it failed or bounced.') },
        ],
        statuses: [
          { label: t('الكل', 'All'), tone: 'outline' },
          { label: t('في الطابور', 'Queued'), tone: 'warning' },
          { label: t('أُرسلت', 'Sent'), tone: 'primary' },
          { label: t('وصلت', 'Delivered'), tone: 'success' },
          { label: t('مرتدّة', 'Bounced'), tone: 'destructive' },
          { label: t('فشلت', 'Failed'), tone: 'destructive' },
          { label: t('موقوفة', 'Suppressed'), tone: 'outline' },
          { label: t('أُلغيت', 'Cancelled'), tone: 'outline' },
          { label: t('شكوى', 'Complaint'), tone: 'destructive', detail: t('شارة موجودة إن سُجّلت شكوى. ليست تبويبًا في التصفية.', 'A badge if a complaint was recorded. It is not a filter tab.') },
          { label: t('لا توجد رسائل بعد', 'No messages yet'), tone: 'outline' },
        ],
      },
      {
        id: 'email-off',
        title: t('عندما يتوقف الإرسال', 'When sending is off'),
        summary: t(
          'إن نقص متغير، تظهر «إرسال البريد متوقف» على هذه الصفحة. إن نقص مفتاح الخدمة لا تُسجَّل رسائل أصلًا. إن نقصت بيانات Resend تُسجَّل الرسائل ولا تُرسل. التنبيه أعلى كل صفحات الإدارة يذكر أيضًا سر استقبال حالات التسليم.',
          'If a variable is missing, Email sending is off appears on this page. If the service key is missing, messages are not recorded at all. If the Resend details are missing, messages are recorded and not sent. The notice on every admin page also names the secret that receives delivery updates.',
        ),
        href: '/admin/email',
        fields: [
          { label: t('لا تُسجَّل رسائل أصلًا', 'Messages are not recorded at all'), detail: t('متغير الخدمة ناقص. الرسالة تفشل من دون أن تُكتب.', 'The service variable is missing. The message fails without being written.') },
          { label: t('تُسجَّل الرسائل لكنها لا تُرسل', 'Messages are recorded but not sent'), detail: t('بيانات Resend ناقصة.', 'The Resend details are missing.') },
        ],
        tips: [
          t('اضبط المتغيرات في Vercel وأعد النشر. الصفحة لا تعرض قيمها.', 'Set the variables in Vercel and redeploy. The page does not show their values.'),
        ],
      },
    ],
  },
  {
    id: 'operations',
    title: t('العمل في الخلفية وطابور الإعادة', 'Background work and the retry queue'),
    lede: t(
      '«العمل في الخلفية»: المهام المجدولة، وطابور إعادة إرسال البريد، والرسائل التي توقفت المنصة عن محاولة إرسالها. مواعيد الجدولة بالتوقيت العالمي كما هي في جدول النشر.',
      'Background work: the scheduled tasks, the email retry queue, and the messages the platform has stopped trying to send. Schedules are in UTC, as written in the deploy schedule.',
    ),
    features: [
      {
        id: 'operations-jobs',
        title: t('المهام المجدولة', 'Scheduled tasks'),
        summary: t(
          'جدول «المهام المجدولة» يعرض اسم المهمة كما تعمل، لا ترجمة له: آخر تشغيل، والمدة بالثواني، وآخر مرة نجحت، ومرات الفشل في آخر سبعة أيام. المهمة التي لم تُشغَّل تحمل «لم تُشغَّل». تحته «آخر مرات التشغيل»، حتى خمسين سطرًا.',
          'The Scheduled tasks table shows the task’s name as it runs, untranslated: last run, duration in seconds, last success, and failures in the last seven days. A task that has never run says Never run. Under it, Recent runs, up to fifty lines.',
        ),
        href: '/admin/operations',
        fields: [
          { label: t('expire-jobs', 'expire-jobs'), detail: t('كل يوم عند 01:00. ينهي الإعلان النشط بعد نافذة الثلاثين يومًا، ويسقط التمييز بعد أربعة عشر يومًا، ويبلّغ الشركة قبل الانتهاء وبعده.', 'Daily at 01:00. Expires an active listing after the thirty-day window, drops featuring after fourteen days, and tells the company before expiry and after it.') },
          { label: t('email-retry', 'email-retry'), detail: t('كل عشر دقائق. يعيد إرسال ما فشل، حتى خمس محاولات، خلال ثمانٍ وأربعين ساعة.', 'Every ten minutes. Resends what failed, up to five attempts, within forty-eight hours.') },
          { label: t('daily-digest', 'daily-digest'), detail: t('كل يوم عند 06:00. ملخص المتقدمين لصاحب العمل، وتذكير واحد باكتمال الملف.', 'Daily at 06:00. The employer’s applicant digest, and a one-time reminder to finish a profile.') },
          { label: t('job-alerts', 'job-alerts'), detail: t('أيام الاثنين من 06:00 حتى 11:00، كل ساعة. بريد التنبيهات المحفوظة، حتى ثماني وظائف في الرسالة.', 'Mondays from 06:00 through 11:00, every hour. Saved-search alert email, up to eight listings in a message.') },
          { label: t('new-jobs', 'new-jobs'), detail: t('كل يوم عند 07:17. إشعار داخل المنصة بوظائف جديدة من بحث محفوظ أو متابعة.', 'Daily at 07:17. An in-product notice of new listings from a saved search or a follow.') },
          { label: t('lifecycle', 'lifecycle'), detail: t('كل يوم عند 02:23. صيانة دورة الحياة، والاحتفاظ بالبيانات، وتنظيف الملفات اليتيمة.', 'Daily at 02:23. Lifecycle maintenance, data retention, and clearing orphaned files.') },
          { label: t('push', 'push'), detail: t('كل خمس دقائق. إرسال إشعارات الهاتف ومتابعة إيصالاتها.', 'Every five minutes. Sends phone notifications and follows up their receipts.') },
        ],
        statuses: [
          { label: t('تعمل', 'Running'), tone: 'primary', detail: t('أو «تعمل الآن» إن كانت جارية عند فتح الصفحة.', 'Or Running now when it is in progress as the page opens.') },
          { label: t('نجحت', 'Succeeded'), tone: 'success' },
          { label: t('فشلت', 'Failed'), tone: 'destructive' },
          { label: t('مُتخطاة', 'Skipped'), tone: 'outline' },
          { label: t('لم تُشغَّل', 'Never run'), tone: 'warning' },
        ],
        tips: [
          t('المهام الخمس الأولى تُعرض دائمًا حتى قبل أول تشغيل. ما عداها يُضاف عندما يُسجَّل له تشغيل.', 'The first five tasks are always listed, even before a first run. Anything else is added once a run is recorded.'),
          t('سجل التشغيل يُبقى نحو تسعين يومًا ثم يُشذَّب.', 'Run history is kept for about ninety days and then pruned.'),
        ],
      },
      {
        id: 'operations-outbox',
        title: t('طابور إعادة الإرسال', 'The retry queue'),
        summary: t(
          '«طابور إعادة الإرسال» يعدّ ما ينتظر الإرسال الآن: المستحق، وما هو قيد الإرسال، وما ينتظر محاولة أخرى، وما أُهمل خلال ثلاثين يومًا. إن وُجد مستحق قديم يظهر «أقدم رسالة مستحقة من …».',
          'The retry queue counts what is waiting to send now: due, in flight, waiting for another try, and given up over thirty days. If something due is old, the page says The oldest due message is from ….',
        ),
        href: '/admin/operations',
        fields: [
          { label: t('مستحقة الآن', 'Due now'), detail: t('حان وقت محاولتها.', 'Its next try is due.') },
          { label: t('قيد الإرسال', 'In flight'), detail: t('محاولة جارية.', 'A try is in progress.') },
          { label: t('بانتظار محاولة أخرى', 'Waiting for another try'), detail: t('فشلت وستُعاد لاحقًا داخل النافذة.', 'It failed and will be tried again later, inside the window.') },
          { label: t('أُهملت، 30 يومًا', 'Given up, 30 days'), detail: t('توقفت المحاولات خلال آخر ثلاثين يومًا.', 'Tries stopped during the last thirty days.') },
        ],
        tips: [
          t('الكنس لا يرسل من زر في هذه اللوحة إلا عبر «جرّب مرة أخرى» على رسالة متعطلة. الدورة التالية كل عشر دقائق هي التي ترسل.', 'The sweep does not send from a button on this screen except Try again on a dead message. The next ten-minute run is what sends.'),
        ],
      },
      {
        id: 'operations-dead',
        title: t('رسائل لم نعد نحاول إرسالها', 'Messages we no longer try to send'),
        summary: t(
          '«رسائل لم نعد نحاول إرسالها»: فشلت في كل المحاولات أو انتهى وقتها. «جرّب مرة أخرى» يمنحها محاولة إضافية في الدورة القادمة، ولا يرسلها في الطلب نفسه. الزر يظهر فقط إن كان القالب يُعاد بناؤه من سجله وكان له كيان. غير ذلك تظهر شرطة. القائمة حتى مئة رسالة.',
          'Messages we no longer try to send: they failed every attempt or ran out of time. Try again gives one more attempt on the next run, and does not send during this request. The button is shown only when the template can be rebuilt from its record and it has an entity. Otherwise a dash is shown. The list is up to one hundred messages.',
        ),
        href: '/admin/operations',
        steps: [
          t('اقرأ «المستلم» و«القالب» و«المحاولات» و«السبب» و«توقفت».', 'Read Recipient, Template, Attempts, Reason and Stopped.'),
          t('إن ظهر «جرّب مرة أخرى» فاضغطه.', 'If Try again is shown, press it.'),
          t('انتظر دورة العشر دقائق. إن لم تعد الرسالة متعطلة عند الضغط يقول الخطأ إنها غير موجودة.', 'Wait for the ten-minute run. If the message was no longer dead when you pressed, the error says it was not found.'),
        ],
        fields: [
          { label: t('لا يمكن إرسال هذا البريد مرة أخرى من سجله', 'This email cannot be rebuilt from its record'), detail: t('ملخصات وبريد لا يملك القالب ما يعيد بناءه. إعادة المحاولة كانت ستفشل وتكتب فوق الخطأ الأصلي.', 'Digests and mail whose template cannot be rebuilt. A retry would fail and overwrite the original error.') },
        ],
        statuses: [
          { label: t('لا توجد رسائل متعطلة', 'No dead messages'), tone: 'success' },
        ],
      },
    ],
  },
  {
    id: 'security',
    title: t('الأمان', 'Security'),
    lede: t(
      '«الأمان»: ما لاحظته المنصة في آخر أربع وعشرين ساعة، ومن قرر ماذا. الأرقام تُقرأ ولا تُعدَّل من الصفحة.',
      'Security: what the platform noticed in the last twenty-four hours, and who decided what. The figures are read here and not edited from the page.',
    ),
    features: [
      {
        id: 'security-summary',
        title: t('ما لوحظ والحالة', 'What was noticed, and the state'),
        summary: t(
          'قسم «ما لوحظ» من آخر يوم. قسم «الحالة» أرقام حالية تفتح صفحاتها.',
          'What was noticed is the last day. State is current figures that open their pages.',
        ),
        href: '/admin/security',
        fields: [
          { label: t('أحداث أمنية', 'Security events'), detail: t('عددها. يُبرز إن كان بينها حدث حرج أو تحذير.', 'The count. Emphasised when a critical event or a warning is among them.') },
          { label: t('مقيّدة المعدل', 'Rate limited'), detail: t('طلبات رُفضت لتجاوز الحد.', 'Requests refused for passing a limit.') },
          { label: t('محاولات دخول فاشلة', 'Failed sign-in attempts'), detail: t('تُبرز إن زادت على عشرين في اليوم.', 'Emphasised when they pass twenty in the day.') },
          { label: t('ملفات مرفوضة', 'Rejected uploads'), detail: t('ملفات لم تُقبل.', 'Files that were not accepted.') },
          { label: t('بيانات تواصل فُتحت', 'Contact details opened'), detail: t('كم مرة فُتحت بيانات تواصل.', 'How many times contact details were opened.') },
          { label: t('حسابات موقوفة', 'Suspended accounts'), detail: t('يفتح الحسابات على «موقوف».', 'Opens Accounts on Suspended.') },
          { label: t('بلاغات مفتوحة', 'Open reports'), detail: t('يفتح «البلاغات».', 'Opens Reports.') },
          { label: t('إعلانات في المراجعة', 'Listings in review'), detail: t('يفتح «الإعلانات».', 'Opens Listings.') },
          { label: t('تسجيلات جديدة', 'New sign-ups'), detail: t('يفتح «الحسابات».', 'Opens Accounts.') },
        ],
      },
      {
        id: 'security-logs',
        title: t('آخر الأحداث وسجل القرارات', 'Recent events and the decision log'),
        summary: t(
          '«آخر الأحداث» خمسون سطرًا: الوقت، والنوع، والدرجة، والطرف. الطرف مختصَر أو بصمة، لا اسم زائر. «سجل القرارات» خمسون سطرًا من سجل الإدارة: الوقت، والمنفّذ، والإجراء، والهدف.',
          'Recent events is fifty rows: time, kind, severity and subject. The subject is shortened or a hash, not a visitor’s name. The decision log is fifty rows from the admin audit: time, actor, action and target.',
        ),
        href: '/admin/security',
        fields: [
          { label: t('وقت', 'Time'), detail: t('بتوقيت القاهرة.', 'In Cairo time.') },
          { label: t('النوع', 'Kind'), detail: t('صنف الحدث كما سجّلته المنصة.', 'The event’s kind, as the platform recorded it.') },
          { label: t('الدرجة', 'Severity'), detail: t('حدة الحدث.', 'How severe the event is.') },
          { label: t('الطرف', 'Subject'), detail: t('جزء من المعرّف أو بصمة. لا يكفي وحده لمعرفة شخص من الصفحة.', 'Part of an id or a hash. On its own it does not name a person from this page.') },
          { label: t('المنفّذ / الإجراء / الهدف', 'Actor / Action / Target'), detail: t('من سجل القرارات، مع الانتقال من حالة إلى حالة إن وُجد.', 'From the decision log, with the move from one state to another when there is one.') },
        ],
        statuses: [
          { label: t('لا شيء بانتظارك', 'Nothing is waiting'), tone: 'outline', detail: t('عندما تخلو قائمة الأحداث.', 'When the event list is empty.') },
        ],
      },
      {
        id: 'security-limits',
        title: t('الحدود المطبّقة', 'The limits in force'),
        summary: t(
          '«الحدود المطبّقة» تقرأ جدول abuse_limits: المفتاح، والفترة بالدقائق، والحد الأقصى. الصفحة لا تعدّلها. التعديل أمر SQL على الجدول مع كتابة السبب في الملاحظة، ويبدأ العمل في الطلب التالي من دون نشر.',
          'The limits in force reads the abuse_limits table: the key, the window in minutes, and the maximum. The page does not edit them. A change is a SQL statement on the table with the reason written in the note, and it takes effect on the next request without a deploy.',
        ),
        href: '/admin/security',
        fields: [
          { label: t('contact_reveal:user:hour', 'contact_reveal:user:hour'), detail: t('ثلاثون كشف تواصل مختلفًا للشخص في الساعة.', 'Thirty distinct contact reveals per person per hour.') },
          { label: t('contact_reveal:user:day', 'contact_reveal:user:day'), detail: t('مئة وعشرون في اليوم للشخص.', 'One hundred and twenty per person per day.') },
          { label: t('contact_reveal:company:day', 'contact_reveal:company:day'), detail: t('ثلاثمئة في اليوم للشركة بكل أعضائها.', 'Three hundred per day for a company, across its members.') },
          { label: t('applications:user:10min', 'applications:user:10min'), detail: t('ثمانية تقديمات في عشر دقائق.', 'Eight applications in ten minutes.') },
          { label: t('applications:user:day', 'applications:user:day'), detail: t('ثلاثون تقديمًا في اليوم.', 'Thirty applications in a day.') },
          { label: t('reports:user:day', 'reports:user:day'), detail: t('عشرة بلاغات في اليوم.', 'Ten reports in a day.') },
          { label: t('jobs:company:day', 'jobs:company:day'), detail: t('عشرون إعلانًا في اليوم للشركة الموثّقة، والمسودات محسوبة.', 'Twenty listings a day for a verified company, drafts included.') },
          { label: t('jobs:company_unverified:day', 'jobs:company_unverified:day'), detail: t('خمسة إعلانات في اليوم لشركة غير موثّقة.', 'Five listings a day for an unverified company.') },
          { label: t('jobs:duplicate_copies:30d', 'jobs:duplicate_copies:30d'), detail: t('نسختان من العنوان نفسه في المنطقة نفسها خلال ثلاثين يومًا، منشورًا أو منتظرًا. الثالثة تُرفض.', 'Two copies of the same title in the same district within thirty days, live or waiting. The third is refused.') },
          { label: t('cv_download:user:hour', 'cv_download:user:hour'), detail: t('ستون سيرة في الساعة.', 'Sixty CVs in an hour.') },
          { label: t('export:user:day', 'export:user:day'), detail: t('خمسة تصديرات للبيانات الشخصية في اليوم.', 'Five personal-data exports in a day.') },
          { label: t('member_lookup:user:day', 'member_lookup:user:day'), detail: t('عشرون بحثًا عن زميل بالبريد في اليوم.', 'Twenty colleague lookups by email in a day.') },
          { label: t('checkout:company:hour', 'checkout:company:hour'), detail: t('خمس جلسات دفع في الساعة للشركة.', 'Five checkout sessions an hour for a company.') },
          { label: t('auth_report:ip:hour', 'auth_report:ip:hour'), detail: t('مئة وعشرون تقرير نتيجة دخول في الساعة من العنوان نفسه.', 'One hundred and twenty sign-in outcome reports an hour from the same address.') },
        ],
        tips: [
          t('الأرقام أعلاه هي القيم المزروعة. إن غُيّرت في الجدول فالصفحة تعرض الرقم الحالي لا هذه القائمة.', 'The figures above are the seeded values. If the table was changed, the page shows the current number, not this list.'),
          t('حد الإعلان الواحد للشركة غير الموثّقة قاعدة نشر منفصلة عن هذه الصفوف، وتظهر عند اعتماد إعلان.', 'The one-listing limit for an unverified company is a separate publishing rule from these rows, and it appears when a listing is approved.'),
        ],
      },
    ],
  },
  {
    id: 'messages',
    title: t('الرسائل والأخطاء', 'Messages and errors'),
    lede: t(
      'كل إجراء في اللوحة يفتح نافذة قبل أن يُنفَّذ. النجاح يظهر بعد أن يُحفظ التغيير وسجله معًا. إن انقطع الاتصال تُحدَّث الصفحة قبل أن تعيد المحاولة.',
      'Every action in the console opens a dialog before it runs. Success appears only after the change and its record are saved together. If the connection drops, the page refreshes before you try again.',
    ),
    features: [
      {
        id: 'messages-confirm',
        title: t('نافذة التأكيد', 'The confirmation dialog'),
        summary: t(
          'الزر يفتح نافذة بعنوان الإجراء وشرحه. «إلغاء» يغلقها. التأكيد يحمل اسم الإجراء، وأثناء الإرسال «لحظة…». بعد النجاح: «تم» وتنبيه «تم: …» ثم تُحدَّث الصفحة.',
          'The button opens a dialog with the action’s title and its explanation. Cancel closes it. Confirm uses the action’s name, and while it sends the label is One moment…. After success: Done, a notice Done: …, then the page refreshes.',
        ),
        fields: [
          { label: t('بلا سبب', 'No reason'), detail: t('اعتماد إعلان، وتوثيق عند عدم اشتراط ملاحظة، وتمييز إعلان، وتفعيل حساب.', 'Approving a listing, verifying when a note is not required, featuring a listing, approving an account.') },
          { label: t('سبب مطلوب', 'Reason required'), detail: t('ثلاثة أحرف على الأقل، وغالبًا حتى خمسمئة. إن كان يصل إلى شخص فعنوان الحقل يقول ذلك: إلى الشركة، أو إلى صاحب الحساب، أو إلى الاستشاري، أو إلى من طلب المراجعة.', 'At least three characters, and usually up to five hundred. When it reaches a person, the field’s label says so: to the company, to the account’s owner, to the consultant, or to the person who appealed.') },
          { label: t('سبب للسجل فقط', 'A reason for the record only'), detail: t('«السبب (يُسجَّل لدينا ولا يُرسل إلى أحد)»: الدور، وباب الدخول، ومنع البلاغات، ورفض بلاغ بسوء نية.', '“Why (kept on the record, sent to nobody)”: role, the sign-in door, restricting reports, and dismissing a report as bad faith.') },
          { label: t('ملاحظة داخلية', 'Internal note'), detail: t('من حرف حتى ألفين. لا تُعدَّل ولا تُحذف.', 'From one character up to two thousand. It is not edited and not deleted.') },
          { label: t('سبب كشف التواصل', 'Contact-reveal reason'), detail: t('من ثلاثة أحرف حتى ثلاثمئة.', 'From three characters up to three hundred.') },
        ],
        tips: [
          t('«أغلق الطلب» في طلبات الحذف هو الاستثناء: ينفَّذ من دون نافذة ومن دون سبب، ولا يحذف الحساب.', 'Close request on deletion requests is the exception: it runs without a dialog and without a reason, and it does not delete the account.'),
          t('للدعم خارج هذه اللوحة: info@topsuite.net.', 'For support outside this console: info@topsuite.net.'),
        ],
      },
      {
        id: 'messages-errors',
        title: t('ما تقوله اللوحة عند التعذر', 'What the console says when it cannot'),
        summary: t(
          'الخطأ جملة ثابتة، لا نص قاعدة البيانات. إن انطبق أكثر من وصف فالصفحة تُحدَّث حتى ترى الحالة الحالية قبل أن تعيد.',
          'An error is a fixed sentence, not the database’s text. When more than one description could apply, the page refreshes so you see the current state before you try again.',
        ),
        statuses: [
          { label: t('غير مسموح لك بهذا', 'You are not allowed to do this'), tone: 'destructive', detail: t('لست مشرفًا، أو الإجراء على حسابك أنت حيث يُمنع ذلك.', 'You are not an admin, or the action is on your own account where that is refused.') },
          { label: t('البيانات المرسلة غير صحيحة', 'The request was not valid'), tone: 'destructive' },
          { label: t('غير موجود', 'Not found'), tone: 'warning', detail: t('ربما عالجه شخص آخر أو حُذف.', 'Someone else may have handled it, or it was removed.') },
          { label: t('هذا حاصل بالفعل', 'That is already the case'), tone: 'outline', detail: t('تم تحديث الصفحة.', 'The page has been refreshed.') },
          { label: t('هذا الإجراء غير متاح', 'That action is not available'), tone: 'warning' },
          { label: t('تغيّرت الحالة', 'The state has changed'), tone: 'warning', detail: t('لم يعد هذا الإجراء مناسبًا. الصفحة تعرض الحالة الحالية.', 'This action no longer applies. The page shows the current state.') },
          { label: t('هذا آخر مشرف', 'This is the last admin'), tone: 'destructive', detail: t('اجعل حسابًا آخر مشرفًا أولًا.', 'Make another account an admin first.') },
          { label: t('تغيّر هذا بعد فتح الصفحة', 'This changed after you opened the page'), tone: 'warning', detail: t('اقرأ النسخة الحالية قبل أن تقرر.', 'Read the current copy before deciding.') },
          { label: t('اكتب سبب (3 حروف على الأقل)', 'Give a reason (at least three characters)'), tone: 'warning' },
          { label: t('السبب أطول من المسموح', 'The reason is too long'), tone: 'warning' },
          { label: t('حد الإعلان الواحد', 'The one-listing limit'), tone: 'warning', detail: t('الشركة غير موثّقة ولديها إعلان فعّال. وثّقها أو أغلق إعلانها الحالي.', 'The company is unverified and already has a live listing. Verify it or close the current one.') },
          { label: t('نفد رصيد الإعلانات', 'No post credits left'), tone: 'warning', detail: t('النشر يخصم إعلانًا من الرصيد.', 'Publishing spends one credit.') },
          { label: t('الشركة موقوفة', 'The company is suspended'), tone: 'destructive', detail: t('لا يمكنها النشر أو تقديم إعلانات للمراجعة.', 'It cannot publish or send listings for review.') },
          { label: t('مستخدم، غيّر الاسم', 'In use; rename it'), tone: 'warning', detail: t('حذف التصنيف يفسد ما يشير إليه.', 'Deleting the taxonomy entry would break what points at it.') },
          { label: t('الرابط لا يتغيّر', 'The slug cannot change'), tone: 'outline' },
          { label: t('الرابط غير مقبول', 'The slug is not valid'), tone: 'warning', detail: t('حروف إنجليزية صغيرة وأرقام وشرطة فقط.', 'Lowercase Latin letters, digits and hyphens only.') },
          { label: t('الاسمان مطلوبان', 'Both names are required'), tone: 'warning', detail: t('حتى ثمانين حرفًا.', 'Up to eighty characters.') },
          { label: t('اختر محافظة موجودة', 'Choose an existing governorate'), tone: 'warning' },
          { label: t('هذا الرابط مستخدم من قبل', 'That slug is already taken'), tone: 'destructive' },
          { label: t('الملف غير متاح الآن', 'The file is not available right now'), tone: 'warning', detail: t('عند فتح مستند.', 'When opening a document.') },
          { label: t('لا يمكن إعادة إرسال هذا البريد', 'This email cannot be sent again'), tone: 'warning' },
          { label: t('تحتاج قاعدة البيانات إلى تحديث', 'The database needs an update'), tone: 'destructive', detail: t('قبل أن يعمل هذا الإجراء.', 'Before this action can work.') },
          { label: t('حدث خطأ غير متوقع', 'Something unexpected went wrong'), tone: 'destructive', detail: t('لم يتغيّر شيء.', 'Nothing was changed.') },
          { label: t('انقطع الاتصال', 'The connection dropped'), tone: 'warning', detail: t('تم تحديث الصفحة — راجع الحالة قبل أن تعيد.', 'The page has been refreshed — check the state before retrying.') },
        ],
      },
    ],
  },
];
