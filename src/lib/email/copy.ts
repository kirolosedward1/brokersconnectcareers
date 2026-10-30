import type { ApplicationStatus } from '@/lib/supabase/database.types';

/**
 * Email copy, deliberately not in messages/*.json.
 *
 * next-intl hands the message bundle to the client provider, so anything added
 * there ships to every browser. Email copy is read by nobody in a browser —
 * putting it there would send twenty templates' worth of strings to every
 * visitor to pay for text only the mail server ever sees.
 *
 * No `server-only` marker: these are strings, nothing here is secret, and the
 * script that generates the Supabase Auth templates has to be able to load it
 * outside Next.
 *
 * Modern Standard Arabic on the Arabic side, the same register as the website
 * and the app (messages/ar.json). Subjects stay literal and unexcited: what
 * happened, and to which listing.
 */

type Locale = 'ar' | 'en';

const arabicPlural = new Intl.PluralRules('ar');

/**
 * A count in Arabic. One and two have forms of their own, three to ten take
 * the plural, eleven and up the singular again. `#` is the number. The
 * categories are the same ones the bell uses in messages/ar.json; the words
 * here are MSA, as the bell is too. Until
 * the categories were split, every number but one took the plural:
 * «فاضل 2 أيام», «11 وظائف جديدة».
 */
function arabicCount(count: number, forms: { one: string; two: string; few: string; other: string }): string {
  const category = arabicPlural.select(count);
  const form = category === 'one' || category === 'two' || category === 'few' ? forms[category] : forms.other;
  return form.replace('#', String(count));
}

const newListings = (count: number) =>
  arabicCount(count, { one: 'وظيفة جديدة', two: 'وظيفتان جديدتان', few: '# وظائف جديدة', other: '# وظيفة جديدة' });

const newApplicants = (count: number) =>
  arabicCount(count, { one: 'متقدم جديد', two: 'متقدمان جديدان', few: '# متقدمين جدد', other: '# متقدم جديد' });

export const emailCopy = {
  ar: {
    siteName: 'بروكرز كونكت',

    footer: {
      // The address is appended, and linked. Without one, the neutral line is used.
      reply: 'هل تحتاج إلى مساعدة؟ يمكنك الرد على هذه الرسالة أو مراسلتنا على',
      neutral: 'هذه الرسالة مُرسلة تلقائيًا.',
      reasonAccount: 'وصلتك هذه الرسالة لأنك مسجّل في بروكرز كونكت.',
      reasonOptional: 'وصلتك هذه الرسالة لأنك فعّلت إشعارات البريد الإلكتروني.',
      privacy: 'الخصوصية',
      terms: 'الشروط',
    },
    unsubscribe: 'إيقاف هذه الإشعارات',

    // -----------------------------------------------------------------------
    // Account
    // -----------------------------------------------------------------------

    welcomeCandidate: {
      subject: 'أهلًا بك في بروكرز كونكت',
      preheader: 'خطوة واحدة وتبدأ الشركات في رؤيتك.',
      heading: 'أهلًا بك',
      body: 'حسابك جاهز. تبحث الشركات هنا عن مستشارين عقاريين وفق الخبرة والمناطق التي يعملون فيها، فكلما اكتمل ملفك أكثر ظهرت لعدد أكبر من الشركات.',
      hint: 'يصل الملف المكتمل إلى شركات أكثر، ويوفّر عليك إعادة كتابة البيانات نفسها مع كل تقديم.',
      cta: 'أكمل ملفك المهني',
    },

    welcomeEmployer: {
      subject: 'أهلًا بك في بروكرز كونكت',
      preheader: 'ابدأ بنشر أول إعلان وظيفة.',
      heading: 'أهلًا بك',
      body: 'تم إنشاء حساب شركتك. يمكنك نشر وظائفك واستقبال المتقدمين في مكان واحد، والتواصل معهم عبر واتساب من داخل المنصة.',
      hint: 'اكتمال بيانات الشركة وتوثيقها يجعلان الإعلان يجذب متقدمين أكثر وأكثر جدية.',
      cta: 'ابدأ استخدام بروكرز كونكت',
    },

    passwordChanged: {
      subject: 'تم تغيير كلمة المرور',
      preheader: 'تأكيد أمني بخصوص حسابك.',
      heading: 'تم تغيير كلمة المرور',
      body: 'تم تغيير كلمة المرور الخاصة بحسابك في بروكرز كونكت للتو.',
      security:
        'إذا لم تكن أنت من غيّرها، فاستخدم «نسيت كلمة المرور» فورًا لاستعادة حسابك.',
      cta: 'إعدادات الحساب',
      labelWhen: 'وقت التغيير',
    },

    profileReady: {
      subject: 'ملفك المهني جاهز',
      preheader: 'ملفك ظاهر للشركات الآن.',
      heading: 'ملفك المهني جاهز',
      body: 'أكملت البيانات الأساسية، وأصبح ملفك ظاهرًا للشركات وفق إعدادات الخصوصية التي اخترتها.',
      cta: 'عرض ملفي',
      labelVisibility: 'الظهور',
    },

    profileIncomplete: {
      subject: 'أكمل ملفك لتتمكن الشركات من رؤيتك',
      preheader: 'تبقّت بعض البيانات في ملفك.',
      heading: 'ملفك غير مكتمل بعد',
      body: 'تفرز الشركات المرشحين حسب الخبرة والمناطق والتخصص. ومن دون هذه البيانات لن يظهر ملفك في نتائج بحثها.',
      hint: 'تُرسل هذه الرسالة مرة واحدة فقط.',
      cta: 'أكمل الملف',
    },

    visibilityChanged: {
      subject: 'تم تغيير إعدادات ظهور ملفك',
      preheader: 'ملفك الآن بالإعداد الجديد.',
      heading: 'تم تحديث إعدادات الظهور',
      body: 'غيّرت من يمكنه رؤية ملفك في دليل المستشارين.',
      security: 'إذا لم تكن أنت من غيّرها، فادخل إلى إعدادات الحساب وغيّر كلمة المرور.',
      cta: 'إدارة إعدادات الخصوصية',
      labelVisibility: 'الظهور الحالي',
      visibility: {
        public: 'ظاهر للجميع',
        verified_employers_only: 'للشركات الموثّقة فقط',
        hidden: 'مخفي تمامًا',
      },
    },

    // -----------------------------------------------------------------------
    // Applications
    // -----------------------------------------------------------------------

    applicationReceived: {
      subject: (job: string) => `وصل طلبك على وظيفة ${job}`,
      preheader: 'استلمنا طلبك.',
      heading: 'استلمنا طلبك',
      body: (job: string, company: string) =>
        `أرسلنا طلبك على وظيفة «${job}» إلى شركة ${company}. ستطّلع الشركة عليه وترد عبر المنصة، وسنبلغك فور حدوث أي تحديث.`,
      note: 'استلام الطلب لا يعني القبول — إنه تأكيد بأن الطلب وصل إلى الشركة.',
      cta: 'تابع طلباتك',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
      labelDate: 'تاريخ التقديم',
      labelRef: 'رقم الطلب',
    },

    newApplication: {
      subject: (job: string) => `متقدم جديد على وظيفة ${job}`,
      preheader: 'تقدّم شخص لوظيفة لديك.',
      heading: 'لديك متقدم جديد',
      body: (name: string, job: string) => `تقدّم ${name} لوظيفة «${job}».`,
      cta: 'عرض المتقدم',
      labelJob: 'الوظيفة',
      labelApplicant: 'المتقدم',
      labelExperience: 'الخبرة',
    },

    statusChanged: {
      subject: (job: string) => `تحديث على طلبك على وظيفة ${job}`,
      preheader: 'هناك تحديث على طلبك.',
      heading: 'تم تحديث طلبك',
      body: (job: string, company: string) =>
        `حدّثت شركة ${company} حالة طلبك على وظيفة «${job}».`,
      cta: 'عرض التفاصيل',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
      labelStatus: 'الحالة الجديدة',
    },

    companyMessage: {
      subject: (company: string) => `رسالة من ${company} عن طلبك`,
      preheader: 'رسالة من الشركة عن طلبك.',
      heading: 'رسالة من الشركة',
      body: (job: string, company: string) => `كتبت لك شركة ${company} عن طلبك على وظيفة «${job}»:`,
      cta: 'عرض طلباتي',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
    },

    applicationRejected: {
      subject: (job: string) => `تحديث على طلبك على وظيفة ${job}`,
      preheader: 'هناك تحديث على طلبك.',
      heading: 'تحديث على طلبك',
      body: (job: string, company: string) =>
        `أكملت شركة ${company} مراجعة المتقدمين لوظيفة «${job}»، ووقع الاختيار على مرشح آخر هذه المرة.`,
      encouragement:
        'تنشر الشركات وظائف جديدة على المنصة كل أسبوع. حافظ على تحديث ملفك وستجد فرصًا أخرى تناسب خبرتك.',
      cta: 'تصفّح وظائف أخرى',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
    },

    applicationWithdrawn: {
      // The subject names the listing, as the other subjects do. The short
      // line is the inbox preview: the row stays, and the company sees it
      // as withdrawn.
      subject: (job: string) => `سُحب طلبك على وظيفة ${job}، وستظهر للشركة حالة الانسحاب`,
      preheader: 'سُحب طلبك، وستظهر للشركة حالة الانسحاب',
      heading: 'تم سحب طلبك',
      body: (job: string) =>
        `تم سحب طلبك على وظيفة «${job}»، وسيظهر للشركة أنك انسحبت من التقديم.`,
      reapply: 'يمكنك التقديم مرة أخرى ما دام الإعلان متاحًا.',
      cta: 'تصفّح الوظائف',
      labelJob: 'الوظيفة',
    },

    candidateWithdrew: {
      // To the listing's owner, in the owner's language only. The name is the
      // one the applicants page still shows; the phone, the email and the CV
      // are not in this message.
      subject: (job: string) => `انسحب مرشح من «${job}»`,
      preheader: 'لم يعد هذا التقديم قائمًا.',
      heading: 'انسحب مرشح',
      body: (job: string) => `انسحب مرشح من «${job}». لم يعد هذا التقديم قائمًا.`,
      bodyNamed: (name: string, job: string) => `انسحب ${name} من «${job}». لم يعد هذا التقديم قائمًا.`,
      cta: 'عرض المتقدمين',
      labelJob: 'الإعلان',
      labelApplicant: 'المرشح',
    },

    // -----------------------------------------------------------------------
    // Listings
    // -----------------------------------------------------------------------

    jobSubmitted: {
      subject: (job: string) => `استلمنا إعلان «${job}»`,
      preheader: 'الإعلان قيد المراجعة.',
      heading: 'استلمنا الإعلان',
      body: (job: string) =>
        `دخل «${job}» مرحلة المراجعة. نراجع الإعلانات لمنع الإعلانات الوهمية، ويستغرق ذلك عادةً يوم عمل واحدًا — وسنراسلك فور الانتهاء.`,
      cta: 'إدارة الوظيفة',
      labelJob: 'الوظيفة',
      labelDate: 'تاريخ الإرسال',
      labelStatus: 'الحالة',
      statusPending: 'قيد المراجعة',
    },

    jobApproved: {
      subject: (job: string) => `تم نشر «${job}»`,
      preheader: 'أصبح إعلانك ظاهرًا للمتقدمين.',
      heading: 'تم نشر إعلانك',
      body: (job: string) => `اجتاز «${job}» المراجعة وأصبح ظاهرًا في نتائج البحث.`,
      cta: 'عرض الإعلان',
      labelJob: 'الوظيفة',
      labelPublished: 'تاريخ النشر',
      labelExpires: 'ينتهي في',
    },

    // The owner's receipt. A different message from jobApproved, which the
    // preference mail to other members still uses.
    jobApprovedOwner: {
      subject: (job: string) => `تمت الموافقة على «${job}»`,
      preheader: 'إعلانك ظاهر للمرشحين الآن.',
      heading: 'تمت الموافقة على إعلانك',
      body: (job: string) => `«${job}» ظاهر للمرشحين الآن. ستصلك رسالة عند كل تقديم جديد.`,
      cta: 'عرض الإعلان',
      labelJob: 'الإعلان',
      labelPublished: 'تاريخ النشر',
      labelExpires: 'تاريخ الانتهاء',
    },

    jobRejected: {
      subject: (job: string) => `«${job}» يحتاج إلى تعديل`,
      preheader: 'يحتاج إعلانك إلى تعديل قبل نشره.',
      heading: 'يحتاج إعلانك إلى تعديل',
      body: (job: string) => `لم يجتز «${job}» المراجعة. عدّله وأعد إرساله.`,
      reason: (note: string) => `سبب الرفض: ${note}`,
      cta: 'تعديل الإعلان',
      labelJob: 'الوظيفة',
    },

    jobExpiring: {
      subject: (job: string) => `«${job}» سينتهي قريبًا`,
      preheader: 'اقترب الإعلان من يومه الأخير.',
      heading: 'إعلانك سينتهي قريبًا',
      body: (job: string, days: number) =>
        days === 1
          ? `غدًا هو اليوم الأخير لـ«${job}». بعد ذلك سيتوقف عن الظهور في نتائج البحث.`
          : `تبقّى ${arabicCount(days, { one: 'يوم واحد', two: 'يومان', few: '# أيام', other: '# يومًا' })} على انتهاء «${job}». بعد ذلك سيتوقف عن الظهور في نتائج البحث.`,
      cta: 'إدارة الوظيفة',
      labelJob: 'الوظيفة',
      labelExpires: 'ينتهي في',
      labelApplicants: 'المتقدمون',
    },

    jobExpired: {
      subject: (job: string) => `انتهت مدة «${job}»`,
      preheader: 'توقف الإعلان عن الظهور.',
      heading: 'انتهت مدة الإعلان',
      body: (job: string) =>
        `انتهت مدة «${job}» وتوقف عن الظهور في نتائج البحث. لا يزال المتقدمون الذين وصلوك موجودين في لوحة التحكم.`,
      cta: 'أعد نشر الإعلان',
      labelJob: 'الوظيفة',
      labelExpired: 'انتهى في',
      labelApplicants: 'إجمالي المتقدمين',
    },

    // -----------------------------------------------------------------------
    // Company
    // -----------------------------------------------------------------------

    accountApproved: {
      subject: 'تم تفعيل حسابك',
      preheader: 'يمكنك نشر إعلاناتك الآن.',
      heading: 'تم تفعيل حسابك',
      body: 'راجعنا بيانات شركتك، وأصبح الحساب مفعّلًا. يمكنك نشر أول إعلان الآن.',
      cta: 'انشر وظيفة',
    },

    accountRejected: {
      subject: 'تم إيقاف حسابك مؤقتًا',
      preheader: 'نحتاج إلى مراجعة بيانات الشركة مرة أخرى.',
      heading: 'تم إيقاف حسابك مؤقتًا',
      body: 'أوقفنا الحساب مؤقتًا إلى حين مراجعة البيانات مرة أخرى.',
      reason: (note: string) => `السبب: ${note}`,
      contact: 'إذا كان ذلك غير صحيح، فراسلنا من صفحة المساعدة وسنراجع الأمر.',
    },

    // The same decisions, for a consultant's account.
    accountApprovedCandidate: {
      subject: 'تم تفعيل حسابك',
      preheader: 'يمكنك التقديم على الوظائف الآن.',
      heading: 'تم تفعيل حسابك',
      body: 'راجعنا حسابك، وأصبح مفعّلًا مجددًا. يمكنك التقديم على الوظائف وتحديث ملفك.',
      cta: 'افتح حسابك',
    },

    accountRejectedCandidate: {
      subject: 'تم إيقاف حسابك مؤقتًا',
      preheader: 'نحتاج إلى مراجعة بيانات حسابك مرة أخرى.',
      heading: 'تم إيقاف حسابك مؤقتًا',
      body: 'أوقفنا الحساب مؤقتًا إلى حين مراجعة البيانات مرة أخرى.',
    },

    companyOwnershipTransferred: {
      subject: (company: string) => `انتقلت ملكية ${company}`,
      preheader: 'تغيّر مالك الشركة على Brokers Connect.',
      heading: 'انتقلت ملكية الشركة',
      bodyNew: (company: string, from: string) =>
        `نقل ${from} إليك ملكية «${company}». أصبحت المالك: تستطيع وحدك نقلها أو حذفها، ولك كل صلاحيات المسؤول.`,
      bodyOld: (company: string, to: string) =>
        `نقلت ملكية «${company}» إلى ${to}. بقيت مسؤولًا في الفريق. إن لم تكن أنت من فعل ذلك، فتواصل معنا فورًا.`,
      cta: 'صفحة الشركة',
      labelCompany: 'الشركة',
    },

    companyVerified: {
      subject: 'تم توثيق شركتك',
      preheader: 'ظهرت علامة التوثيق على صفحتك.',
      heading: 'تم توثيق شركتك',
      body: (company: string) =>
        `راجعنا مستندات «${company}» وكل شيء سليم. ظهرت علامة التوثيق على صفحة الشركة وعلى جميع إعلاناتك، وأصبح بإمكانك الاطلاع على ملفات المستشارين المخصّصة للشركات الموثّقة.`,
      cta: 'عرض صفحة الشركة',
      labelCompany: 'الشركة',
    },

    companyVerificationNeeded: {
      subject: 'مطلوب إجراء لاستكمال توثيق شركتك',
      preheader: 'تنقص طلبَ التوثيق بعضُ المستندات.',
      heading: 'التوثيق يتطلب إجراءً منك',
      body: (company: string) =>
        `لم تكتمل مراجعة مستندات «${company}». نحتاج إلى السجل التجاري والبطاقة الضريبية بصورة واضحة وسارية.`,
      reason: (note: string) => `ملاحظة: ${note}`,
      cta: 'استكمال البيانات',
      labelCompany: 'الشركة',
    },

    companyVerificationRevoked: {
      subject: 'تم إلغاء توثيق شركتك',
      preheader: 'أُزيلت علامة التوثيق من صفحة الشركة.',
      heading: 'لم تعد شركتك موثّقة',
      body: (company: string) =>
        `أُزيلت علامة التوثيق من صفحة «${company}» ومن إعلاناتها، ومعها إمكانية الاطلاع على ملفات المستشارين المخصّصة للشركات الموثّقة. يمكنك طلب التوثيق مجددًا من صفحة الشركة بسجل تجاري وبطاقة ضريبية ساريين، وإذا كان لديك أي سؤال فراسلنا.`,
      cta: 'عرض صفحة الشركة',
      labelCompany: 'الشركة',
    },

    // -----------------------------------------------------------------------
    // Optional
    // -----------------------------------------------------------------------

    digest: {
      subject: (count: number, label: string) => `${newListings(count)} في «${label}»`,
      preheader: 'وظائف جديدة تطابق البحث المحفوظ لديك.',
      heading: 'جديد في بحثك',
      body: (label: string) => `هذه هي الوظائف التي نُشرت هذا الأسبوع وتطابق «${label}».`,
      cta: 'عرضها جميعًا',
    },

    /*
      The same email, for somebody who followed a company rather than saved a
      search.

      Underneath they are one row and one weekly job, which is the whole point
      of building a follow that way — but the words above cannot be shared. A
      follower who reads "جديد في بحثك" is being told about a saved search
      they do not remember making, and the next thing they do is look for it to
      turn it off. The subject line happens to work for both, so only the three
      strings that name the mechanism change.
    */
    follow: {
      subject: (count: number, label: string) => `${newListings(count)} في «${label}»`,
      preheader: 'وظائف جديدة من شركة تتابعها.',
      heading: 'جديد من شركة تتابعها',
      body: (label: string) => `نشرت «${label}» هذه الوظائف هذا الأسبوع.`,
      cta: 'عرضها جميعًا',
    },

    applicantDigest: {
      subject: (count: number) => `لديك ${newApplicants(count)}`,
      preheader: 'ملخّص المتقدمين اليوم.',
      heading: 'متقدمون جدد',
      body: (count: number) => `وصلك ${newApplicants(count)} منذ آخر رسالة أرسلناها إليك.`,
      cta: 'عرض المتقدمين',
    },

    status: {
      new: 'جديد',
      shortlisted: 'في القائمة المختصرة',
      interview: 'مقابلة',
      hired: 'تم القبول',
      rejected: 'غير مناسب',
      withdrawn: 'انسحب المتقدم',
    } satisfies Record<ApplicationStatus, string>,
  },

  en: {
    siteName: 'Brokers Connect',

    footer: {
      // The address is appended, and linked. Without one, the neutral line is used.
      reply: 'Need help? Reply to this email or write to',
      neutral: 'This is an automated message.',
      reasonAccount: 'You are receiving this because you have a Brokers Connect account.',
      reasonOptional: 'You are receiving this because email notifications are on.',
      privacy: 'Privacy',
      terms: 'Terms',
    },
    unsubscribe: 'Turn off these emails',

    welcomeCandidate: {
      subject: 'Welcome to Brokers Connect',
      preheader: 'One step and companies can find you.',
      heading: 'Welcome',
      body: 'Your account is ready. Companies here search by experience, track and the districts you work — the more complete your profile, the more of them you reach.',
      hint: 'A complete profile also saves you retyping the same details on every application.',
      cta: 'Complete your profile',
    },

    welcomeEmployer: {
      subject: 'Welcome to Brokers Connect',
      preheader: 'Start with your first listing.',
      heading: 'Welcome',
      body: 'Your company account is set up. Post roles, receive applicants in one place, and reach them on WhatsApp from inside the platform.',
      hint: 'Complete company details and verification bring more, and better, applicants.',
      cta: 'Get started',
    },

    passwordChanged: {
      subject: 'Your password was changed',
      preheader: 'A security confirmation for your account.',
      heading: 'Your password was changed',
      body: 'The password on your Brokers Connect account has just been changed.',
      security:
        'If this was not you, use "forgot password" straight away to take the account back.',
      cta: 'Account settings',
      labelWhen: 'Changed at',
    },

    profileReady: {
      subject: 'Your profile is live',
      preheader: 'Companies can see you now.',
      heading: 'Your profile is ready',
      body: 'The essentials are done, and your profile is visible to companies according to the privacy setting you chose.',
      cta: 'View my profile',
      labelVisibility: 'Visibility',
    },

    profileIncomplete: {
      subject: 'Complete your profile so companies can find you',
      preheader: 'A few details are still missing.',
      heading: 'Your profile is incomplete',
      body: 'Companies filter by experience, districts and specialism. Without those, your profile does not appear in their results.',
      hint: 'We send this once.',
      cta: 'Complete profile',
    },

    visibilityChanged: {
      subject: 'Your profile visibility changed',
      preheader: 'Your profile is now on the new setting.',
      heading: 'Visibility updated',
      body: 'You changed who can see your profile in the consultant directory.',
      security: 'If this was not you, open account settings and change your password.',
      cta: 'Manage privacy settings',
      labelVisibility: 'Current visibility',
      visibility: {
        public: 'Visible to everyone',
        verified_employers_only: 'Verified companies only',
        hidden: 'Hidden',
      },
    },

    applicationReceived: {
      subject: (job: string) => `Application received for ${job}`,
      preheader: 'We have your application.',
      heading: 'Application received',
      body: (job: string, company: string) =>
        `Your application for "${job}" at ${company} has been sent. The company reviews and replies through the platform, and we will tell you as soon as it moves.`,
      note: 'Receiving an application is not an offer — this confirms it reached the company.',
      cta: 'Track your applications',
      labelJob: 'Role',
      labelCompany: 'Company',
      labelDate: 'Applied on',
      labelRef: 'Reference',
    },

    newApplication: {
      subject: (job: string) => `New applicant for ${job}`,
      preheader: 'Somebody applied to one of your listings.',
      heading: 'You have a new applicant',
      body: (name: string, job: string) => `${name} applied for "${job}".`,
      cta: 'View applicant',
      labelJob: 'Role',
      labelApplicant: 'Applicant',
      labelExperience: 'Experience',
    },

    statusChanged: {
      subject: (job: string) => `Update on your application for ${job}`,
      preheader: 'There is an update on your application.',
      heading: 'Your application moved',
      body: (job: string, company: string) =>
        `${company} updated the status of your application for "${job}".`,
      cta: 'View details',
      labelJob: 'Role',
      labelCompany: 'Company',
      labelStatus: 'New status',
    },

    companyMessage: {
      subject: (company: string) => `A message from ${company} about your application`,
      preheader: 'A message from the company about your application.',
      heading: 'A message from the company',
      body: (job: string, company: string) => `${company} wrote to you about your application for "${job}":`,
      cta: 'My applications',
      labelJob: 'Role',
      labelCompany: 'Company',
    },

    applicationRejected: {
      subject: (job: string) => `Update on your application for ${job}`,
      preheader: 'There is an update on your application.',
      heading: 'An update on your application',
      body: (job: string, company: string) =>
        `${company} has finished reviewing applicants for "${job}" and has gone with someone else this time.`,
      encouragement:
        'New roles are posted here every week. Keep your profile current and you will see others that fit your experience.',
      cta: 'Browse other roles',
      labelJob: 'Role',
      labelCompany: 'Company',
    },

    applicationWithdrawn: {
      subject: (job: string) => `You withdrew your application for ${job}`,
      preheader: 'The company can see that you withdrew.',
      heading: 'Application withdrawn',
      body: (job: string) =>
        `Your application for "${job}" has been withdrawn, and the company can see that.`,
      reapply: 'You can apply again at any time while the listing is open.',
      cta: 'Browse roles',
      labelJob: 'Role',
    },

    candidateWithdrew: {
      subject: (job: string) => `A candidate withdrew from "${job}"`,
      preheader: 'This application is no longer active.',
      heading: 'A candidate withdrew',
      body: (job: string) => `A candidate withdrew from "${job}". This application is no longer active.`,
      bodyNamed: (name: string, job: string) => `${name} withdrew from "${job}". This application is no longer active.`,
      cta: 'View applicants',
      labelJob: 'Listing',
      labelApplicant: 'Candidate',
    },

    jobSubmitted: {
      subject: (job: string) => `We have your listing for "${job}"`,
      preheader: 'The listing is under review.',
      heading: 'Listing received',
      body: (job: string) =>
        `"${job}" is in review. We check listings to keep fake adverts off the board — usually within a working day — and we will write as soon as it is done.`,
      cta: 'Manage listing',
      labelJob: 'Role',
      labelDate: 'Submitted',
      labelStatus: 'Status',
      statusPending: 'In review',
    },

    jobApproved: {
      subject: (job: string) => `"${job}" is live`,
      preheader: 'Your listing is visible to candidates.',
      heading: 'Your listing is live',
      body: (job: string) => `"${job}" passed review and now appears in search results.`,
      cta: 'View listing',
      labelJob: 'Role',
      labelPublished: 'Published',
      labelExpires: 'Expires',
    },

    jobApprovedOwner: {
      subject: (job: string) => `"${job}" is approved`,
      preheader: 'Candidates can see your listing now.',
      heading: 'Your listing is approved',
      body: (job: string) =>
        `"${job}" is visible to candidates now. You will receive an email for each new application.`,
      cta: 'View the listing',
      labelJob: 'Listing',
      labelPublished: 'Published',
      labelExpires: 'Closes',
    },

    jobRejected: {
      subject: (job: string) => `"${job}" needs changes`,
      preheader: 'Your listing needs a change before it goes live.',
      heading: 'Your listing needs changes',
      body: (job: string) => `"${job}" did not pass review. Make the changes and resubmit it.`,
      reason: (note: string) => `Reason: ${note}`,
      cta: 'Edit listing',
      labelJob: 'Role',
    },

    jobExpiring: {
      subject: (job: string) => `"${job}" expires soon`,
      preheader: 'Your listing is near its last day.',
      heading: 'Your listing expires soon',
      body: (job: string, days: number) =>
        days === 1
          ? `Tomorrow is the last day for "${job}". After that it stops appearing in search results.`
          : `"${job}" expires in ${days} days. After that it stops appearing in search results.`,
      cta: 'Manage listing',
      labelJob: 'Role',
      labelExpires: 'Expires',
      labelApplicants: 'Applicants',
    },

    jobExpired: {
      subject: (job: string) => `"${job}" has expired`,
      preheader: 'The listing stopped appearing.',
      heading: 'Your listing has expired',
      body: (job: string) =>
        `"${job}" reached the end of its run and no longer appears in search results. The applicants you received are still in your dashboard.`,
      cta: 'Post it again',
      labelJob: 'Role',
      labelExpired: 'Expired',
      labelApplicants: 'Total applicants',
    },

    accountApproved: {
      subject: 'Your account is active',
      preheader: 'You can publish listings now.',
      heading: 'Your account is active',
      body: 'We have reviewed your company details and activated the account. You can post your first listing now.',
      cta: 'Post a role',
    },

    accountRejected: {
      subject: 'Your account is on hold',
      preheader: 'We need to review the company details again.',
      heading: 'Your account is on hold',
      body: 'We have paused the account until we can review the details again.',
      reason: (note: string) => `Reason: ${note}`,
      contact: 'If this is wrong, write to us from the help page and we will look again.',
    },

    // The same decisions, for a consultant's account.
    accountApprovedCandidate: {
      subject: 'Your account is active',
      preheader: 'You can apply for roles now.',
      heading: 'Your account is active',
      body: 'We have reviewed your account and it is active again. You can apply for roles and update your profile.',
      cta: 'Open your account',
    },

    accountRejectedCandidate: {
      subject: 'Your account is on hold',
      preheader: 'We need to review your account details again.',
      heading: 'Your account is on hold',
      body: 'We have paused the account until we can review the details again.',
    },

    companyOwnershipTransferred: {
      subject: (company: string) => `Ownership of ${company} has changed`,
      preheader: "The company's owner on Brokers Connect has changed.",
      heading: 'Company ownership changed',
      bodyNew: (company: string, from: string) =>
        `${from} handed ownership of "${company}" to you. You are now the owner: only you can hand it on or delete it, and you have every admin permission.`,
      bodyOld: (company: string, to: string) =>
        `You handed ownership of "${company}" to ${to}. You stay on the team as an admin. If this wasn't you, contact us at once.`,
      cta: 'Company page',
      labelCompany: 'Company',
    },

    companyVerified: {
      subject: 'Your company is verified',
      preheader: 'The badge is on your page.',
      heading: 'Your company is verified',
      body: (company: string) =>
        `We reviewed the documents for "${company}" and everything checks out. The badge now appears on your company page and on every listing, and you can see consultant profiles reserved for verified companies.`,
      cta: 'View company page',
      labelCompany: 'Company',
    },

    companyVerificationNeeded: {
      subject: 'Action needed to finish verifying your company',
      preheader: 'Documents are missing from the request.',
      heading: 'Verification needs something from you',
      body: (company: string) =>
        `The document review for "${company}" could not be completed. We need a clear, current commercial register and tax card.`,
      reason: (note: string) => `Note: ${note}`,
      cta: 'Complete the details',
      labelCompany: 'Company',
    },

    companyVerificationRevoked: {
      subject: "Your company's verification was removed",
      preheader: 'The badge is no longer on your company page.',
      heading: 'Your company is no longer verified',
      body: (company: string) =>
        `The verified badge no longer appears on "${company}"'s page or its listings, and the consultant profiles reserved for verified companies are closed to it. You can ask for verification again from the company page, with a current commercial register and tax card. If you have a question, write to us.`,
      cta: 'Open the company page',
      labelCompany: 'Company',
    },

    digest: {
      subject: (count: number, label: string) =>
        count === 1 ? `A new role matching "${label}"` : `${count} new roles matching "${label}"`,
      preheader: 'New roles matching your saved search.',
      heading: 'New in your search',
      body: (label: string) => `These went up this week and match "${label}".`,
      cta: 'See them all',
    },

    follow: {
      subject: (count: number, label: string) =>
        count === 1 ? `A new role at "${label}"` : `${count} new roles at "${label}"`,
      preheader: 'New roles from a company you follow.',
      heading: 'New from a company you follow',
      body: (label: string) => `"${label}" posted these this week.`,
      cta: 'See them all',
    },

    applicantDigest: {
      subject: (count: number) =>
        count === 1 ? 'You have a new applicant' : `You have ${count} new applicants`,
      preheader: "Today's applicant summary.",
      heading: 'New applicants',
      body: (count: number) =>
        count === 1
          ? 'One new applicant since we last wrote.'
          : `${count} new applicants since we last wrote.`,
      cta: 'View applicants',
    },

    status: {
      new: 'New',
      shortlisted: 'Shortlisted',
      interview: 'Interview',
      hired: 'Hired',
      rejected: 'Not selected',
      withdrawn: 'Withdrawn',
    } satisfies Record<ApplicationStatus, string>,
  },
} as const;

export function copyFor(locale: string | null | undefined) {
  return locale === 'en' ? emailCopy.en : emailCopy.ar;
}

export function localeOf(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'ar';
}
