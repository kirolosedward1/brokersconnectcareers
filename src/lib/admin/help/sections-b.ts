import { text, type HelpSection } from './types';

const t = text;

/** Reports, appeals, accounts, applications, consultants, audit. */
export const SECTIONS_B: HelpSection[] = [
  {
    id: 'reports',
    title: t('البلاغات', 'Reports'),
    lede: t(
      '«البلاغات»: حالة واحدة لكل إعلان أو شركة أو ملف استشاري أُبلغ عنه. الأخطر أولًا، ثم الأكثر إبلاغًا، ثم الأقدم انتظارًا.',
      'Reports: one case per listing, company or consultant profile that was reported. The most serious allegation first, then the most people, then the longest wait.',
    ),
    features: [
      {
        id: 'reports-queue',
        title: t('قائمة الحالات', 'The case list'),
        summary: t(
          '«جديدة» و«قيد المراجعة» حالات مجمّعة: كل ما أُبلغ عنه معًا. «حُلّت» و«رُفضت» صفوف البلاغات نفسها، الأحدث قرارًا أولًا. نوع الهدف: «الكل»، أو «إعلانات»، أو «شركات»، أو «ملفات الاستشاريين».',
          'New and In review are grouped cases: everything reported about one thing, together. Resolved and Dismissed are the reports themselves, newest decision first. The target type is All, Listings, Companies, or Consultant profiles.',
        ),
        href: '/admin/reports',
        fields: [
          { label: t('الخطورة', 'Severity'), detail: t('من السبب الذي اختاره المبلّغ: «منخفضة»، «متوسطة»، «عالية». هذا الادعاء لا الحكم.', 'From the reason the reporter chose: Low, Medium, High. The allegation, not a verdict.') },
          { label: t('عدد المبلّغين', 'Reporter count'), detail: t('يُبرز إن أبلغ أكثر من شخص.', 'Emphasised when more than one person reported.') },
          { label: t('علامة من المنصة', 'A platform flag'), detail: t('البلاغ جاء من فحص النص، لا من شخص.', 'The report came from the text check, not from a person.') },
          { label: t('ماذا كان مكتوبًا وقت البلاغ', 'What was written when it was reported'), detail: t('يظهر إن حُذف الهدف، حتى يبقى السياق.', 'Shown when the target was deleted, so the context remains.') },
        ],
        statuses: [
          { label: t('جديدة', 'New'), tone: 'warning', detail: t('ما زال بلاغ واحد على الأقل مفتوحًا. عشرون حالة في الصفحة.', 'At least one report is still open. Twenty cases a page.') },
          { label: t('قيد المراجعة', 'In review'), tone: 'accent', detail: t('لا بلاغ مفتوح؛ الباقي تحت التحقيق.', 'No report still open; what remains is under investigation.') },
          { label: t('حُلّت', 'Resolved'), tone: 'success', detail: t('ثلاثون بلاغًا في الصفحة.', 'Thirty reports a page.') },
          { label: t('رُفضت', 'Dismissed'), tone: 'outline', detail: t('أُغلقت على أنها بلا مخالفة.', 'Closed as no breach.') },
          { label: t('مفتوح', 'Open'), tone: 'warning' },
          { label: t('تحت التحقيق', 'Under investigation'), tone: 'accent' },
          { label: t('حُلّ', 'Resolved'), tone: 'success' },
          { label: t('لا مخالفة', 'No breach'), tone: 'outline' },
        ],
        tips: [
          t('سطر المبلّغين يذكر حسابات عمرها أقل من أسبوع، ومن لديهم بلاغات سابقة بلا أساس أو بسوء نية، ومن هم أصحاب شركات. لا شيء من ذلك يقرر؛ الأزرار قرارك.', 'The reporter line names accounts younger than a week, people whose earlier reports were groundless or in bad faith, and employers. None of that decides; the buttons are your decision.'),
        ],
      },
      {
        id: 'reports-filters',
        title: t('فلترة البلاغات', 'Filtering reports'),
        summary: t(
          'النموذج «فلترة البلاغات» يحدّث العنوان، فيمكن إرسال الرابط لزميل. «امسح الفلاتر» يعيد القائمة.',
          'The Filters form updates the address, so the link can be sent to a colleague. Clear filters restores the list.',
        ),
        href: '/admin/reports',
        fields: [
          { label: t('السبب', 'Reason'), detail: t('أحد أسباب البلاغ، أو «أي سبب»: إعلان وهمي، بيانات مضللة، مكرر، مزعج، تمييز، احتيال، انتحال، مضايقة، شركة مثيرة للريبة، محتوى مسيء، أو سبب آخر.', 'One report reason, or Any reason: fake listing, misleading pay, duplicate, spam, discriminatory terms, scam, impersonation, harassment, a suspicious company, offensive content, or another reason.') },
          { label: t('الخطورة', 'Severity'), detail: t('«أي خطورة»، أو «العالية فقط»، أو «المتوسطة والعالية».', 'Any severity, High only, or Medium and high.') },
          { label: t('من يوم / حتى يوم', 'From / Until'), detail: t('تاريخان بتوقيت القاهرة.', 'Two dates, in Cairo time.') },
          { label: t('أُبلغ عنها من أكثر من شخص', 'Reported by more than one person'), detail: t('في «جديدة» و«قيد المراجعة» فقط.', 'On New and In review only.') },
          { label: t('طبّق', 'Apply'), detail: t('يثبّت الفلاتر في العنوان.', 'Writes the filters into the address.') },
        ],
      },
      {
        id: 'reports-act',
        title: t('العمل على حالة', 'Acting on a case'),
        summary: t(
          'ما دام الهدف موجودًا يمكن تحريك كل البلاغات المفتوحة عليه معًا. الإجراء الذي ينزّل أو يوقف أو يقيّد يطلب سببًا يصل إلى الشركة أو إلى الاستشاري. التحقيق والإغلاق من دون إجراء والمخالفة غير المؤكدة ملاحظتها اختيارية.',
          'While the target still exists, every open report on it can be moved together. The action that takes down, suspends or restricts asks for a reason that reaches the company or the consultant. Investigate, resolve with no action, and no-breach have an optional note.',
        ),
        steps: [
          t('اقرأ البلاغات والعلامات.', 'Read the reports and the flags.'),
          t('«ابدأ تحقيق» إن كنت تتولاها، حتى يراها الباقون «تحت التحقيق».', 'Start an investigation if you are taking it, so others see Under investigation.'),
          t('أو أغلقها بأحد أزرار الحل.', 'Or close it with one of the resolution buttons.'),
        ],
        fields: [
          { label: t('ابدأ تحقيق', 'Start an investigation'), detail: t('ما دام هناك بلاغ مفتوح.', 'While an open report remains.') },
          { label: t('أنزل الإعلان وأغلق البلاغات', 'Take the listing down and close the reports'), detail: t('لإعلان منشور أو منتظر. يختفي أو يُرفض، ويصل الشركة السبب.', 'For a live or waiting listing. It comes down or is rejected, and the company receives the reason.') },
          { label: t('أوقف الشركة وأغلق البلاغات', 'Suspend the company and close the reports'), detail: t('للشركة القائمة. تُنزَّل إعلاناتها المنشورة والمنتظرة.', 'For a listed company. Its live and waiting listings come down.') },
          { label: t('قيّد الملف وأغلق البلاغات', 'Restrict the profile and close the reports'), detail: t('لملف غير مقيّد. يختفي من الدليل ومن أصحاب العمل حتى يُرفع القيد. السبب يصل إلى الاستشاري.', 'For a profile that is not already restricted. It leaves the directory and employers until the restriction is lifted. The reason reaches the consultant.') },
          { label: t('حُلّت دون إجراء', 'Resolved with no action'), detail: t('مثلًا إن عدّلت الشركة المشكلة بنفسها. لن يُنزَّل شيء.', 'For example if the company fixed it themselves. Nothing is taken down.') },
          { label: t('لا مخالفة', 'No breach'), detail: t('تُغلق البلاغات على أنها بلا مخالفة، ويُحتسب ذلك في سجل المبلّغ.', 'The reports close as no breach, and that counts on the reporter’s record.') },
        ],
        tips: [
          t('زر الإنزال أو الإيقاف أو التقييد يظهر فقط عندما ما زال الهدف يقبل هذا الإجراء.', 'The take-down, suspend or restrict button is shown only while the target can still take that action.'),
        ],
      },
      {
        id: 'reports-special',
        title: t('سوء النية وهدف حُذف', 'Bad faith, and a target that was deleted'),
        summary: t(
          'بلاغ واحد من شخص يمكن رفضه بسوء نية من دون إغلاق باقي الحالة. إن حُذف ما أُبلغ عنه تبقى البلاغات المفتوحة، ولا يبقى سوى إغلاقها.',
          'A single report from a person can be dismissed as bad faith without closing the rest of the case. If what was reported has been deleted, the open reports remain, and closing them is all that is left.',
        ),
        fields: [
          { label: t('ارفضه: بسوء نية', 'Dismiss it: bad faith'), detail: t('يغلق هذا البلاغ فقط. السبب يُسجَّل ولا يُرسل إلى أحد. لا يمنع المبلّغ وحده؛ المنع من صفحة حسابه.', 'Closes this report only. The reason is recorded and sent to nobody. It does not restrict the reporter by itself; that is a separate decision on their account page.') },
          { label: t('أغلقها: حُلّت', 'Close them: resolved'), detail: t('لبلاغات هدف حُذف. يحتفظ كل بلاغ بما كان مكتوبًا وقت البلاغ.', 'For reports whose target was deleted. Each report keeps what was written at the time.') },
          { label: t('أغلقها: لا مخالفة', 'Close them: no breach'), detail: t('الإغلاق الآخر للهدف المحذوف.', 'The other close for a deleted target.') },
        ],
        statuses: [
          { label: t('سوء نية', 'Bad faith'), tone: 'destructive' },
          { label: t('حُذف', 'Deleted'), tone: 'outline' },
          { label: t('ممنوع من البلاغات', 'Reporting restricted'), tone: 'destructive' },
          { label: t('حساب عمره أقل من أسبوع', 'Account younger than a week'), tone: 'warning' },
          { label: t('صاحب شركة', 'An employer'), tone: 'accent' },
        ],
      },
    ],
  },
  {
    id: 'appeals',
    title: t('طلبات المراجعة', 'Appeals'),
    lede: t(
      '«طلبات المراجعة»: يرى أحد أن قرارًا يخصه كان خطأ. الأقدم أولًا — فهو المنتظر منذ وقت أطول. الصفحة عشرون طلبًا.',
      'Appeals: somebody says a decision about them was wrong. Oldest first — they have been waiting longest. A page is twenty appeals.',
    ),
    features: [
      {
        id: 'appeals-read',
        title: t('قراءة طلب', 'Reading an appeal'),
        summary: t(
          'كل بطاقة موضوع واحد: إعلان، أو إيقاف شركة، أو حساب، أو ملف استشاري. تعرض القرار كما كان وقت الاعتراض، وسبب المشرف آنذاك، ونص صاحب الطلب.',
          'Each card is one subject: a listing, a company suspension, an account, or a consultant profile. It shows the decision as it stood when appealed, the moderator’s reason at the time, and what the person wrote.',
        ),
        href: '/admin/appeals',
        fields: [
          { label: t('القرار المعترَض عليه', 'The decision appealed'), detail: t('حالة الإعلان، أو «موقوفة»، أو حالة الحساب، أو «مقيّد».', 'The listing’s status, or Suspended, or the account’s state, or Restricted.') },
          { label: t('ملاحظة المشرف', 'The moderator’s note'), detail: t('كما كُتبت وقت القرار، بين علامتي اقتباس.', 'As it was written at the time, in quotes.') },
          { label: t('صاحب الطلب', 'The person'), detail: t('رابط إلى حسابه، أو «حُذف الحساب».', 'A link to their account, or Account already deleted.') },
        ],
        statuses: [
          { label: t('بانتظار', 'Waiting'), tone: 'warning', detail: t('التبويب الافتراضي، الأقدم أولًا.', 'The default tab, oldest first.') },
          { label: t('رُدّ عليها', 'Answered'), tone: 'outline', detail: t('الأحدث ردًا أولًا، مع من ردّ ومتى.', 'Newest answer first, with who answered and when.') },
          { label: t('أُلغي القرار', 'Decision reversed'), tone: 'success' },
          { label: t('القرار كما هو', 'Decision stands'), tone: 'outline' },
        ],
      },
      {
        id: 'appeals-decide',
        title: t('الرد على الطلب', 'Answering an appeal'),
        summary: t(
          '«الغي القرار» يعكس القرار بالأداة نفسها التي استُخدمت أصلًا، في الحركة نفسها. «يبقى القرار كما هو» يثبّته، والسبب الذي تكتبه يُرسل إلى من طلب المراجعة. الإلغاء ملاحظته اختيارية؛ الإبقاء سببه مطلوب.',
          'Reverse the decision undoes it through the same lever that made it, in the same step. Let it stand keeps it, and the reason you write is sent to the person who appealed. Reversal’s note is optional; letting it stand requires a reason.',
        ),
        href: '/admin/appeals',
        steps: [
          t('افتح الموضوع من رابطه وتأكد أن القرار ما زال قائمًا.', 'Open the subject from its link and check the decision still stands.'),
          t('اختر «الغي القرار» أو «يبقى القرار كما هو».', 'Choose Reverse the decision or Let it stand.'),
          t('في الإبقاء اكتب «ملاحظة للشخص (تُرسل إليه)».', 'When letting it stand, write Note to the person (sent to them).'),
        ],
        fields: [
          { label: t('إعلان', 'Listing'), detail: t('الإلغاء يعيده للنشر بقواعد أي موافقة: حد الإعلانات والرصيد ما زالا ساريين. إن انتهت المدة أثناء الإيقاف قد يعود منتهيًا.', 'Reversal puts it back through the rules of any approval: the listing limit and credits still apply. If the window ran out while it was down, it may come back expired.') },
          { label: t('إيقاف شركة', 'Company suspension'), detail: t('الإلغاء يرفع الإيقاف. الإعلانات لا تعود وحدها؛ أعد ما يستحق واحدًا واحدًا.', 'Reversal lifts the suspension. Listings do not come back by themselves; restore the ones that should, one by one.') },
          { label: t('حساب', 'Account'), detail: t('الإلغاء يعيد الحساب إلى العمل.', 'Reversal makes the account active again.') },
          { label: t('ملف استشاري', 'Consultant profile'), detail: t('الإلغاء يرفع القيد. يبقى الملف مخفيًا حتى يختار الاستشاري من يراه.', 'Reversal lifts the restriction. The profile stays hidden until the consultant chooses who can see it.') },
        ],
        tips: [
          t('يصل صاحب الطلب إشعارًا في المنصة بالنتيجة في الحالتين.', 'The person is notified in the product either way.'),
        ],
      },
    ],
  },
  {
    id: 'accounts',
    title: t('الحسابات', 'Accounts'),
    lede: t(
      '«الحسابات»: ابحث عن أي حساب، وافحصه، وفعّله أو أوقفه. البريد والهاتف لا يظهران في القائمة.',
      'Accounts: find any account, inspect it, and approve it or turn it off. Email and phone are not on the list.',
    ),
    features: [
      {
        id: 'accounts-list',
        title: t('البحث في الحسابات', 'Finding an account'),
        summary: t(
          'البحث: «اسم، بريد كامل، رقم هاتف، أو رمز الحساب…». الاسم بجزء منه، والبريد والهاتف والرمز كاملين. النتائج لا تعرض البريد ولا الهاتف. الصفحة خمسة وعشرون صفًا، والمنتظر أولًا داخل التصفية.',
          'Search is “Name, full email, phone number, or account id…”. A name matches a fragment; email, phone and id match in full. Results do not show the email or the phone. A page is twenty-five rows, with pending first inside the filter.',
        ),
        href: '/admin/users',
        fields: [
          { label: t('الاسم', 'Name'), detail: t('يفتح الملف.', 'Opens the file.') },
          { label: t('النوع', 'Role'), detail: t('مرشح، أو صاحب عمل، أو «الإدارة».', 'Candidate, employer, or Admin.') },
          { label: t('الشركة / الملف', 'Company / profile'), detail: t('اسم الشركة، أو «ملف استشاري» ومعه «مقيّد» إن وُجد.', 'The company name, or Consultant profile and Restricted when that applies.') },
          { label: t('انضم', 'Joined'), detail: t('تاريخ التسجيل.', 'The sign-up date.') },
          { label: t('آخر دخول', 'Last sign-in'), detail: t('آخر مرة دخل.', 'The last time they signed in.') },
          { label: t('الحالة', 'Status'), detail: t('شارة الموافقة، و«تسجيل الدخول موقوف» إن أُغلق الباب.', 'The approval badge, and Sign-in blocked when the door is shut.') },
        ],
        statuses: [
          { label: t('الكل', 'All'), tone: 'outline' },
          { label: t('تحت المراجعة', 'Pending'), tone: 'warning' },
          { label: t('مفعّل', 'Approved'), tone: 'success' },
          { label: t('موقوف', 'Suspended'), tone: 'destructive' },
          { label: t('تسجيل الدخول موقوف', 'Sign-in blocked'), tone: 'destructive', detail: t('هذا الباب، لا حالة الموافقة. يمكن أن يجتمعا.', 'This is the door, not the approval state. Both can show at once.') },
          { label: t('كل الأنواع', 'All roles'), tone: 'outline' },
        ],
      },
      {
        id: 'accounts-tabs',
        title: t('تبويبات الملف', 'The account tabs'),
        summary: t(
          'الملف أربعة تبويبات: «نظرة عامة»، «النشاط»، «تسجيل الدخول والأمان»، «السجل والملاحظات». الإجراءات والتواصل والبلاغات التي قدّمها تبقى في الجانب في كل تبويب.',
          'The file has four tabs: Overview, Activity, Sign-in and security, and Record and notes. Actions, contact and the reports they filed stay in the side column on every tab.',
        ),
        href: '/admin/users',
        fields: [
          { label: t('نظرة عامة', 'Overview'), detail: t('الدور، والحالة، و«ملاحظة القرار»، ورمز الحساب، والشركات بعضويته، وملف الاستشاري إن وُجد.', 'Role, status, Decision note, account id, companies they belong to, and the consultant profile when there is one.') },
          { label: t('النشاط', 'Activity'), detail: t('للمرشح: طلباته حسب المرحلة. لصاحب العمل: إعلانات شركته. ثم التظلمات، والإعلانات المحفوظة، والملاحظات، والقرارات. «لا شيء بعد» إن كانت الأعداد صفرًا.', 'For a candidate: applications by stage. For an employer: the company’s listings. Then appeals, saved listings, notes and decisions. Nothing yet when every count is zero.') },
          { label: t('تسجيل الدخول والأمان', 'Sign-in and security'), detail: t('تأكيد البريد، وطريقة الدخول، وآخر دخول، والتحقق بخطوتين، وعدد الأجهزة.', 'Whether email is confirmed, how they sign in, last sign-in, two-step sign-in, and how many devices.') },
          { label: t('السجل والملاحظات', 'Record and notes'), detail: t('ملاحظة داخلية لا تُعدَّل، ثم سجل القرارات على هذا الحساب.', 'An internal note that cannot be edited, then the decisions recorded on this account.') },
        ],
      },
      {
        id: 'accounts-standing',
        title: t('التفعيل والإيقاف والتعليق', 'Approve, suspend and hold'),
        summary: t(
          'من «الإجراءات». حسابات المشرفين لا تُوقَف من هنا، ويظهر بدل الأزرار «لا تُوقَف حسابات المشرفين من هنا.» التفعيل والاستعادة بلا سبب ويصل صاحبهما بريد. التعليق والإيقاف يعرضان «السبب (اختياري، يصل إلى صاحب الحساب)»، ويمكن تركه فارغًا.',
          'From Actions. Admin accounts are not suspended from here, and the buttons are replaced by “Admin accounts cannot be suspended from here.” Approval and restoration need no reason, and the person is emailed. A hold and a suspension offer “Reason (optional, sent to the account holder)”, and it may be left empty.',
        ),
        fields: [
          { label: t('فعّل الحساب', 'Approve the account'), detail: t('يستطيع الحساب العمل مرة أخرى، ويصل صاحبه بريد. يظهر ما دام غير مفعّل.', 'The account can work again, and its owner is emailed. Shown while it is not approved.') },
          { label: t('استعادة الحساب', 'Restore the account'), detail: t('نفس مسار التفعيل عندما تكون الحالة «موقوف».', 'The same approval path when the state is Suspended.') },
          { label: t('قيّد الحساب حتى المراجعة', 'Restrict while reviewing'), detail: t('للمفعّل. تقييد لا إيقاف. صاحب العمل: تبقى إعلاناته المنشورة، ولا يستطيع النشر أو التعديل أو الإغلاق أو إرسال شيء للمراجعة حتى ترفعه. المرشح: تبقى طلباته، ولا يستطيع التقديم على وظائف جديدة. يُبلَّغان بالسبب ويستطيعان طلب مراجعة.', 'For an approved account. A hold, not a suspension. An employer keeps live listings, but cannot post, edit, close or send anything for review until you lift it. A candidate keeps their applications, but cannot apply to new jobs. Both are told the reason and can appeal.') },
          { label: t('أوقف الحساب', 'Suspend the account'), detail: t('للمرشح: لن يستطيع التقديم أو الإبلاغ، ويصل صاحبه السبب. لصاحب العمل: إيقاف الحساب يغلق أيضًا كل إعلانات الشركة المنشورة، إلا إذا كان لزميل آخر حساب نشط.', 'For a candidate: they cannot apply or report, and they receive the reason. For an employer: suspending the account also closes every live listing of the company, unless another colleague still has an active account.') },
        ],
        tips: [
          t('لا تستطيع تغيير موافقة حسابك أنت، ولا حساب مشرف.', 'You cannot change the approval of your own account, nor of an admin account.'),
        ],
      },
      {
        id: 'accounts-door',
        title: t('الدور وباب الدخول', 'Role and the sign-in door'),
        summary: t(
          'من تبويب «تسجيل الدخول والأمان». هذه الإجراءات لا تُرسل بريدًا، والسبب «يُسجَّل لدينا ولا يُرسل إلى أحد». لا تظهر على حسابك أنت.',
          'From the Sign-in and security tab. These actions send no email, and the reason is kept on the record and sent to nobody. They are not shown on your own account.',
        ),
        fields: [
          { label: t('اجعله مشرفًا', 'Make an admin'), detail: t('تصله لوحة الإدارة كاملة. التحقق بخطوتين اختياري ما لم تشترطه المنصة. أبلغه بنفسك. لا يظهر إن كان الحساب غير مفعّل — «اعتمد الحساب أولًا: الترقية لا ترفع الإيقاف» — ولا إن كان تسجيل الدخول موقوفًا.', 'They get the whole console. Two-step sign-in stays optional unless the platform requires it. Tell them yourself. Hidden when the account is not approved — “Approve the account first: a promotion does not lift a hold” — and when sign-in is blocked.') },
          { label: t('أزل صلاحية الإدارة', 'Remove admin access'), detail: t('يعود مرشحًا أو صاحب عمل حسب عضوية الشركة. لا تستطيع إزالة صلاحيتك، ولا إزالة آخر مشرف: «هذا آخر مشرف: ستبقى لوحة الإدارة من دون أحد. اجعل حسابًا آخر مشرفًا أولًا.»', 'They become a candidate or an employer again, depending on company membership. You cannot remove your own access, nor the last admin: “This is the last admin: the console would be left with nobody. Make another account an admin first.”') },
          { label: t('أوقف تسجيل الدخول', 'Block sign-in'), detail: t('لحساب ليس مشرفًا. يُسجَّل خروجه من كل الأجهزة ولن يدخل حتى ترفع الإيقاف. الإعلانات والطلبات كما هي. لإيقافها استخدم «أوقف الحساب».', 'For an account that is not an admin. They are signed out of every device and cannot sign in until you lift it. Listings and applications stay as they are. To stop those, use Suspend the account.') },
          { label: t('اسمح بتسجيل الدخول', 'Allow sign-in'), detail: t('يعيد فتح الباب.', 'Opens the door again.') },
          { label: t('سجّل خروجه من كل الأجهزة', 'Sign out everywhere'), detail: t('يُسجَّل خروج كل جهاز خلال ساعة. يستطيع الدخول مرة أخرى مباشرة.', 'Every device is signed out within the hour. They can sign in again at once.') },
        ],
        statuses: [
          { label: t('تسجيل الدخول مسموح', 'Sign-in allowed'), tone: 'success' },
          { label: t('تسجيل الدخول موقوف', 'Sign-in blocked'), tone: 'destructive' },
        ],
      },
      {
        id: 'accounts-contact',
        title: t('عرض بيانات التواصل', 'Revealing contact details'),
        summary: t(
          'لا تظهر بيانات التواصل في أي قائمة. «اعرض بيانات التواصل» يعرض سببًا اختياريًا حتى ثلاثمئة حرف، ويُسجَّل مع اسمك قبل أن يعود البريد والهاتف. إن تركته فارغًا يُحفظ السجل بلا سبب. بعد العرض: «سُجّل أنك فتحت بيانات التواصل هذه والسبب.» على حسابك أنت يظهر «هذا حسابك.»',
          'Contact details are not on any list. Reveal contact details offers an optional reason of up to three hundred characters, and records it with your name before the email and phone come back. Leave it empty and the record stores no reason. Afterwards: “It is recorded that you opened these contact details, and why.” On your own account the page says This is your account.',
        ),
        href: '/admin/users',
        steps: [
          t('من «التواصل» اضغط «اعرض بيانات التواصل».', 'Under Contact, press Reveal contact details.'),
          t('اكتب «السبب».', 'Write the reason.'),
          t('اقرأ «البريد الإلكتروني» و«الهاتف». الرابط يفتح واتساب إن وُجد رقم.', 'Read Email and Phone. The link opens WhatsApp when there is a number.'),
        ],
        tips: [
          t('بيانات تواصل الاستشاري ليست في دليل الإدارة. صفحة الملف تقول: «بيانات التواصل على صفحة الحساب، ويجب أن تكتب سببًا.»', 'A consultant’s contact details are not on the admin directory. The profile page says: contact details are on the account page, and you must write a reason.'),
        ],
      },
      {
        id: 'accounts-reporting',
        title: t('البلاغات التي قدّمها الحساب', 'Reports this account filed'),
        summary: t(
          'الجانب يعدّ بلاغاته وما رُفض منها، وينبّه إن كان أغلبها بلا أساس أو بسوء نية. «امنعه من البلاغات» يمنعه وحده؛ باقي الحساب كما هو. عندما يحاول يُقال له إن البلاغات غير متاحة، من دون السبب. السبب يُسجَّل ولا يُرسل.',
          'The side column counts the reports they filed and how many were dismissed, and warns when most were groundless or in bad faith. Restrict reporting stops reporting only; the rest of the account stays. When they try, they are told reporting is unavailable, without the reason. The reason is recorded and not sent.',
        ),
        fields: [
          { label: t('امنعه من البلاغات', 'Restrict reporting'), detail: t('لا يظهر لحساب مشرف ولا لحسابك.', 'Not shown for an admin account, nor for your own.') },
          { label: t('أعِد له صلاحية الإبلاغ', 'Allow reporting again'), detail: t('يعود إلى الحدود المطبّقة على الجميع.', 'They return to the same limits as everyone.') },
        ],
        statuses: [
          { label: t('ممنوع من البلاغات', 'Reporting restricted'), tone: 'destructive', detail: t('مع التاريخ والسبب بين علامتي اقتباس.', 'With the date and the reason in quotes.') },
        ],
      },
    ],
  },
  {
    id: 'applications',
    title: t('طلبات التقديم', 'Applications'),
    lede: t(
      '«طلبات التقديم»: للتحقيق فقط. ماذا حدث للطلب، ومن حرّكه ومتى. لا تعديل من هنا.',
      'Applications: for investigation only. What happened to the application, and who moved it and when. Nothing is edited from here.',
    ),
    features: [
      {
        id: 'applications-list',
        title: t('قائمة الطلبات', 'The applications list'),
        summary: t(
          'ابحث في «اسم المتقدم أو رمز الطلب…». يمكن حصر القائمة بإعلان واحد أو متقدم واحد من العنوان، وتقول الصفحة «معروضة طلبات إعلان واحد أو متقدم واحد فقط» ومعها «اعرض الكل». الصفحة خمسة وعشرون صفًا.',
          'Search is “Applicant name or application id…”. The address can limit the list to one listing or one applicant, and the page then says Only one listing’s or one applicant’s applications are shown, with Show all. A page is twenty-five rows.',
        ),
        href: '/admin/applications',
        fields: [
          { label: t('المتقدم', 'Applicant'), detail: t('الاسم.', 'The name.') },
          { label: t('الإعلان', 'Listing'), detail: t('عنوانه.', 'Its title.') },
          { label: t('الشركة', 'Company'), detail: t('اسمها.', 'Its name.') },
          { label: t('أُرسل', 'Sent'), detail: t('تاريخ التقديم.', 'When it was sent.') },
          { label: t('الشركة فتحته', 'Opened by the company'), detail: t('التاريخ، أو «لم يُفتح».', 'The date, or Not opened.') },
          { label: t('الحالة', 'Status'), detail: t('مرحلة الطلب.', 'The application’s stage.') },
        ],
        statuses: [
          { label: t('الكل', 'All'), tone: 'outline' },
          { label: t('لم تُفتح منذ أسبوع', 'Unopened for a week'), tone: 'warning', detail: t('حالته جديدة، ولم تفتحه الشركة، ومضى أكثر من سبعة أيام. الأقدم أولًا.', 'Still new, the company has not opened it, and more than seven days have passed. Oldest first.') },
          { label: t('جديد', 'New'), tone: 'primary' },
          { label: t('قائمة مختصرة', 'Shortlisted'), tone: 'accent' },
          { label: t('مقابلة', 'Interview'), tone: 'warning' },
          { label: t('تم التعيين', 'Hired'), tone: 'success' },
          { label: t('غير مناسب', 'Not a fit'), tone: 'destructive' },
        ],
        tips: [
          t('أسماء المراحل هي أسماء المنتج في شارة الطلب. تحريك المرحلة قرار الشركة، وسحب الطلب قرار المتقدم.', 'The stage names are the product’s names on the application badge. Moving a stage is the company’s decision, and withdrawing is the applicant’s.'),
        ],
      },
      {
        id: 'applications-detail',
        title: t('طلب واحد', 'One application'),
        summary: t(
          'أعلى الصفحة: «هذه الصفحة للقراءة فقط. تحريك الطلب قرار الشركة، وسحبه قرار المتقدم.» لا تُعرض السيرة، ولا نص ملاحظات الشركة الداخلية، بل عددها فقط.',
          'At the top: This page is read-only. Moving the application is the company’s decision, and withdrawing it is the applicant’s. The CV is not shown, nor the text of the company’s private notes — only how many there are.',
        ),
        href: '/admin/applications',
        fields: [
          { label: t('الطلب', 'Application'), detail: t('الحالة، وتاريخ الإرسال، وتاريخ الفتح، والخبرة، و«رسالة الشركة للمتقدم»، وعدد «ملاحظات الشركة الداخلية»، ورمز الطلب.', 'Status, sent date, opened date, experience, The company’s message to the applicant, the count of The company’s private notes, and the application id.') },
          { label: t('رسالة المتقدم', 'The applicant’s note'), detail: t('تُطوى، وتظهر فقط إن كُتبت.', 'Collapsed, and shown only when one was written.') },
          { label: t('الأطراف', 'Parties'), detail: t('روابط المتقدم والإعلان والشركة مع شاراتهم.', 'Links to the applicant, the listing and the company, with their badges.') },
          { label: t('تحركات الطلب', 'Application history'), detail: t('من مرحلة إلى مرحلة، واسم من حرّكها ودوره، أو «غير مسجّل»، والتاريخ.', 'From one stage to another, the name and role of who moved it, or Not recorded, and the date.') },
          { label: t('السجل والملاحظات', 'Record and notes'), detail: t('يمكنك إضافة ملاحظة داخلية للمشرفين. لا تغيّر الطلب.', 'You can add an internal note for admins. It does not change the application.') },
        ],
      },
    ],
  },
  {
    id: 'agents',
    title: t('دليل الاستشاريين', 'Consultant directory'),
    lede: t(
      'في الإدارة، «دليل الاستشاريين» يعرض كل الملفات سواء كانت ظاهرة أو مخفية. بيانات التواصل على صفحة الحساب فقط. آخر عنصر في قائمة الإدارة يحمل الاسم نفسه ويفتح الدليل العام كما يراه أصحاب العمل.',
      'In the console, Consultant directory lists every profile whether it is visible or hidden. Contact details are only on the account page. The last item in the admin menu has the same name and opens the public directory as employers see it.',
    ),
    features: [
      {
        id: 'agents-list',
        title: t('قائمة الملفات', 'The profile list'),
        summary: t(
          'ابحث في «اسم الاستشاري أو رابط الملف…». التبويبات: «الكل»، و«ظاهر لكل الشركات»، و«للشركات الموثّقة فقط»، و«مخفي تمامًا»، و«مقيّد». الصفحة خمسة وعشرون صفًا.',
          'Search is “Consultant name or profile link…”. The tabs are All, Visible to every company, Verified companies only, Hidden entirely, and Restricted. A page is twenty-five rows.',
        ),
        href: '/admin/agents',
        fields: [
          { label: t('الاسم', 'Name'), detail: t('اسم صاحب الملف.', 'The profile owner’s name.') },
          { label: t('الرابط', 'Link'), detail: t('جزء العنوان العام.', 'The public address slug.') },
          { label: t('الخبرة', 'Experience'), detail: t('بالسنوات.', 'In years.') },
          { label: t('الإتاحة', 'Availability'), detail: t('«مستعد للعروض»، أو «على رأس العمل»، أو «يبحث عن عمل».', 'Open to offers, Employed, not looking, or Actively searching.') },
          { label: t('الحساب', 'Account'), detail: t('حالة الموافقة.', 'The approval state.') },
          { label: t('الظهور', 'Visibility'), detail: t('من يراه، أو «مقيّد».', 'Who can see it, or Restricted.') },
          { label: t('انضم', 'Joined'), detail: t('تاريخ الملف.', 'When the profile was created.') },
        ],
        statuses: [
          { label: t('ظاهر لكل الشركات', 'Visible to every company'), tone: 'success' },
          { label: t('للشركات الموثّقة فقط', 'Verified companies only'), tone: 'primary' },
          { label: t('مخفي تمامًا', 'Hidden entirely'), tone: 'outline' },
          { label: t('مقيّد', 'Restricted'), tone: 'destructive', detail: t('قرار مشرف، لا اختيار الاستشاري.', 'An admin’s decision, not the consultant’s choice.') },
        ],
        tips: [
          t('عنصر القائمة الذي يفتح /agents هو الدليل العام للمراجعة كما يراه صاحب عمل معتمد. عنصر /admin/agents هو هذه القائمة.', 'The menu item that opens /agents is the public directory, for review as an approved employer sees it. The item for /admin/agents is this list.'),
        ],
      },
      {
        id: 'agents-restrict',
        title: t('تقييد الملف أو رفع القيد', 'Restricting a profile or lifting it'),
        summary: t(
          '«قيّد الملف» يخفيه من الدليل ومن أصحاب العمل، ولن يستطيع الاستشاري إظهاره مرة أخرى حتى يُرفع القيد. لا يتأثر حسابه ولا تقديماته. «ارفع القيد» يبقي الملف مخفيًا حتى يختار الاستشاري بنفسه الظهور. السببان مطلوبان. سبب التقييد يصل إلى الاستشاري.',
          'Restrict the profile hides it from the directory and from employers, and the consultant cannot show it again until the restriction is lifted. Their account and applications are not affected. Lift the restriction leaves the profile hidden until the consultant chooses to be visible. Both reasons are required. The restriction reason reaches the consultant.',
        ),
        href: '/admin/agents',
        steps: [
          t('اقرأ الملف والبلاغات عنه.', 'Read the profile and the reports about it.'),
          t('اضغط «قيّد الملف» واكتب «السبب (يصل إلى الاستشاري)».', 'Press Restrict the profile and write The reason (sent to the consultant).'),
          t('للرفع: «ارفع القيد» مع سبب يُسجَّل.', 'To lift it: Lift the restriction, with a reason that is recorded.'),
        ],
        fields: [
          { label: t('الرابط العام', 'Public page'), detail: t('يظهر فقط إن لم يكن الملف مقيّدًا ولا «مخفي تمامًا».', 'Shown only when the profile is neither restricted nor Hidden entirely.') },
          { label: t('اللغات / وحدات مباعة / قيمة المبيعات / مرفق السيرة', 'Languages / Units sold / Sales value / CV attached'), detail: t('حقائق الملف كما سجّلها.', 'The profile’s facts, as recorded.') },
          { label: t('بلاغات عن الملف', 'Reports about the profile'), detail: t('حتى خمسين، مع رابط صاحب البلاغ.', 'Up to fifty, with a link to the reporter.') },
          { label: t('صاحب الحساب', 'Account owner'), detail: t('رابط إلى صفحة الحساب حيث تُطلب بيانات التواصل بسبب.', 'A link to the account page, where contact details are asked for with a reason.') },
        ],
        statuses: [
          { label: t('مقيّد', 'Restricted'), tone: 'destructive', detail: t('لافتة بتاريخ القيد والسبب.', 'A banner with the date and the reason.') },
        ],
      },
    ],
  },
  {
    id: 'audit',
    title: t('سجل القرارات', 'Audit log'),
    lede: t(
      '«سجل القرارات»: كل قرار اتُّخذ من الإدارة، ومن اتخذه ومتى ولماذا. هذا السجل لا يُعدَّل ولا يُحذف.',
      'Audit log: every decision made from the console, who made it, when and why. This log is not edited and not deleted.',
    ),
    features: [
      {
        id: 'audit-log',
        title: t('قراءة السجل', 'Reading the log'),
        summary: t(
          'لا يوجد بحث نصي. التبويبات تحت «عن» هي نوع الهدف: الحسابات، والشركات، والإعلانات، وملفات الاستشاريين، وطلبات التقديم، و«التصنيفات»، و«تعديل مباشر». يمكن حصر السجل بمشرف أو بهدف من العنوان. الصفحة خمسون صفًا.',
          'There is no text search. The tabs under About are the target’s kind: accounts, companies, listings, consultant profiles, applications, Taxonomy, and Direct edit. The address can limit the log to one admin or one target. A page is fifty rows.',
        ),
        href: '/admin/audit',
        fields: [
          { label: t('الوقت', 'Time'), detail: t('بتوقيت القاهرة.', 'In Cairo time.') },
          { label: t('الإجراء', 'Action'), detail: t('اسم القرار كما في السجل: نشر إعلان، توثيق شركة، فتح بيانات تواصل، وغير ذلك.', 'The decision’s name as the log writes it: a listing published, a company verified, contact details opened, and the rest.') },
          { label: t('تعديل مباشر', 'Direct edit'), detail: t('تغيير جاء من مسار غير أزرار هذه اللوحة، وتجاوز نافذة السبب. يستحق قراءة السبب إن وُجد.', 'A change that did not come through this console’s buttons, and skipped the reason dialog. Read the reason when one is there.') },
          { label: t('الهدف', 'Target'), detail: t('رابط إلى الملف إن كان للصفحة مسار.', 'A link to the file when the page has a path.') },
          { label: t('السبب', 'Reason'), detail: t('بين علامتي اقتباس إن كُتب.', 'In quotes when one was written.') },
          { label: t('المنفّذ', 'Actor'), detail: t('رابط يصفّي السجل على هذا المشرف، أو «مشرف سابق».', 'A link that filters the log to that admin, or Former admin.') },
        ],
        statuses: [
          { label: t('لا توجد قرارات أو ملاحظات مسجّلة بعد', 'No decisions or notes recorded yet'), tone: 'outline' },
        ],
        tips: [
          t('الملاحظة الداخلية التي تضيفها من «أضف ملاحظة» تظهر في سجل الصفحة نفسها، ولا تُمسح.', 'The internal note you add with Add a note shows on that page’s record, and it is not erased.'),
        ],
      },
    ],
  },
];
