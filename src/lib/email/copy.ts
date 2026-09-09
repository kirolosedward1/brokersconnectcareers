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
 * Egyptian dialect on the Arabic side, matching the rest of the product. The
 * platform's own voice is the one people already recognise from the interface,
 * and an inbox that suddenly switches to formal broadcast Arabic reads as a
 * different company. Subjects stay literal and unexcited: what happened, and
 * to which listing.
 */

type Locale = 'ar' | 'en';

export const emailCopy = {
  ar: {
    siteName: 'بروكرز كونكت',

    footer: {
      automated: 'الرسالة دي مرسلة تلقائياً، من فضلك ما تردّش عليها.',
      reasonAccount: 'وصلتك الرسالة دي لأنك مسجّل في بروكرز كونكت.',
      reasonOptional: 'وصلتك الرسالة دي لأنك مفعّل إشعارات البريد.',
      privacy: 'الخصوصية',
      terms: 'الشروط',
      help: 'محتاج مساعدة؟ ابعتلنا على',
    },
    unsubscribe: 'وقّف الإشعارات دي',

    // -----------------------------------------------------------------------
    // Account
    // -----------------------------------------------------------------------

    welcomeCandidate: {
      subject: 'أهلاً بيك في بروكرز كونكت',
      preheader: 'خطوة واحدة والشركات تبدأ تشوفك.',
      heading: 'أهلاً بيك',
      body: 'حسابك جاهز. الشركات هنا بتدوّر على مستشارين عقاريين بالخبرة والمناطق اللي بيشتغلوا فيها، فكل ما ملفك يكون مكتمل أكتر كل ما ظهرت لناس أكتر.',
      hint: 'الملف المكتمل بيوصل لشركات أكتر، وبيوفّر عليك إعادة كتابة نفس البيانات مع كل تقديم.',
      cta: 'استكمل ملفك المهني',
    },

    welcomeEmployer: {
      subject: 'أهلاً بيك في بروكرز كونكت',
      preheader: 'ابدأ بأول إعلان وظيفة.',
      heading: 'أهلاً بيك',
      body: 'حساب شركتك اتعمل. تقدر تنشر وظايفك وتستقبل المتقدمين في مكان واحد، وتكلّمهم على واتساب من جوه المنصة.',
      hint: 'بيانات الشركة المكتملة والتوثيق بيخلّوا الإعلان يجيب متقدمين أكتر وأجدّ.',
      cta: 'ابدأ استخدام بروكرز كونكت',
    },

    profileReady: {
      subject: 'ملفك المهني بقى جاهز',
      preheader: 'ملفك ظاهر للشركات دلوقتي.',
      heading: 'ملفك المهني جاهز',
      body: 'خلّصت الأساسيات، وملفك بقى ظاهر للشركات حسب إعدادات الخصوصية اللي اخترتها.',
      cta: 'اعرض ملفي',
      labelVisibility: 'الظهور',
    },

    profileIncomplete: {
      subject: 'كمّل ملفك عشان الشركات تشوفك',
      preheader: 'باقي شوية بيانات على ملفك.',
      heading: 'ملفك لسه ناقص',
      body: 'الشركات بتفلتر بالخبرة والمناطق والتخصص. من غير البيانات دي ملفك مش بيظهر في نتايج بحثهم.',
      hint: 'الرسالة دي بتتبعت مرة واحدة بس.',
      cta: 'كمّل الملف',
    },

    visibilityChanged: {
      subject: 'اتغيّرت إعدادات ظهور ملفك',
      preheader: 'ملفك دلوقتي بالإعداد الجديد.',
      heading: 'اتحدّثت إعدادات الظهور',
      body: 'غيّرت مين يقدر يشوف ملفك في دليل المستشارين.',
      security: 'لو مش إنت اللي غيّرتها، ادخل على إعدادات الحساب وغيّر كلمة السر.',
      cta: 'إدارة إعدادات الخصوصية',
      labelVisibility: 'الظهور الحالي',
      visibility: {
        public: 'ظاهر للكل',
        verified_employers_only: 'للشركات الموثّقة بس',
        hidden: 'مخفي تماماً',
      },
    },

    // -----------------------------------------------------------------------
    // Applications
    // -----------------------------------------------------------------------

    applicationReceived: {
      subject: (job: string) => `وصل طلبك على ${job}`,
      preheader: 'استلمنا طلبك.',
      heading: 'استلمنا طلبك',
      body: (job: string, company: string) =>
        `بعتنا طلبك على وظيفة «${job}» لشركة ${company}. الشركة هتشوفه وتردّ من خلال المنصة، وهنبلّغك أول ما يتحرّك.`,
      note: 'استلام الطلب مش معناه القبول — ده تأكيد إن الطلب وصل للشركة.',
      cta: 'تابع طلباتك',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
      labelDate: 'تاريخ التقديم',
      labelRef: 'رقم الطلب',
    },

    newApplication: {
      subject: (job: string) => `متقدم جديد على ${job}`,
      preheader: 'حد قدّم على وظيفة عندك.',
      heading: 'وصلك متقدم جديد',
      body: (name: string, job: string) => `${name} قدّم على وظيفة «${job}».`,
      cta: 'شوف المتقدم',
      labelJob: 'الوظيفة',
      labelApplicant: 'المتقدم',
      labelExperience: 'الخبرة',
    },

    statusChanged: {
      subject: (job: string) => `تحديث على طلبك في ${job}`,
      preheader: 'في تحديث على طلب التقديم بتاعك.',
      heading: 'طلبك اتحرّك',
      body: (job: string, company: string) =>
        `شركة ${company} حدّثت حالة طلبك على وظيفة «${job}».`,
      cta: 'شوف التفاصيل',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
      labelStatus: 'الحالة الجديدة',
    },

    applicationRejected: {
      subject: (job: string) => `تحديث بخصوص تقديمك على ${job}`,
      preheader: 'في تحديث على طلبك.',
      heading: 'تحديث على طلبك',
      body: (job: string, company: string) =>
        `شركة ${company} كمّلت مراجعة المتقدمين لوظيفة «${job}»، والاختيار وقع على حد تاني المرة دي.`,
      encouragement:
        'في شركات بتنشر وظايف جديدة على المنصة كل أسبوع. خلّي ملفك محدّث وهتلاقي فرص تانية تناسب خبرتك.',
      cta: 'اتصفح وظايف تانية',
      labelJob: 'الوظيفة',
      labelCompany: 'الشركة',
    },

    applicationWithdrawn: {
      subject: (job: string) => `سحبت طلبك على ${job}`,
      preheader: 'الطلب اتشال من عند الشركة.',
      heading: 'اتسحب طلبك',
      body: (job: string) =>
        `شِلنا طلبك على وظيفة «${job}»، والشركة مابقتش شايفاه. تقدر تقدّم تاني في أي وقت طول ما الإعلان شغال.`,
      cta: 'اتصفح الوظايف',
      labelJob: 'الوظيفة',
    },

    // -----------------------------------------------------------------------
    // Listings
    // -----------------------------------------------------------------------

    jobSubmitted: {
      subject: (job: string) => `استلمنا إعلان «${job}»`,
      preheader: 'الإعلان تحت المراجعة.',
      heading: 'استلمنا الإعلان',
      body: (job: string) =>
        `«${job}» دخل المراجعة. بنراجع الإعلانات عشان نمنع الإعلانات الوهمية، وده بياخد يوم عمل غالباً — وهنبعتلك أول ما نخلص.`,
      cta: 'إدارة الوظيفة',
      labelJob: 'الوظيفة',
      labelDate: 'تاريخ الإرسال',
      labelStatus: 'الحالة',
      statusPending: 'تحت المراجعة',
    },

    jobApproved: {
      subject: (job: string) => `تم نشر «${job}»`,
      preheader: 'إعلانك بقى ظاهر للمتقدمين.',
      heading: 'إعلانك اتنشر',
      body: (job: string) => `«${job}» عدّى المراجعة وبقى ظاهر في نتايج البحث.`,
      cta: 'شوف الإعلان',
      labelJob: 'الوظيفة',
      labelPublished: 'تاريخ النشر',
      labelExpires: 'ينتهي في',
    },

    jobRejected: {
      subject: (job: string) => `«${job}» محتاج تعديل`,
      preheader: 'إعلانك محتاج تعديل قبل ما يتنشر.',
      heading: 'إعلانك محتاج تعديل',
      body: (job: string) => `«${job}» ماعدّاش المراجعة. عدّله وابعته تاني.`,
      reason: (note: string) => `سبب الرفض: ${note}`,
      cta: 'عدّل الإعلان',
      labelJob: 'الوظيفة',
    },

    jobExpiring: {
      subject: (job: string) => `«${job}» هينتهي قريب`,
      preheader: 'الإعلان قرّب على آخر يوم.',
      heading: 'إعلانك هينتهي قريب',
      body: (job: string, days: number) =>
        days === 1
          ? `«${job}» آخر يوم ليه بكرة. بعدها هيقف عن الظهور في نتايج البحث.`
          : `فاضل ${days} أيام على انتهاء «${job}». بعدها هيقف عن الظهور في نتايج البحث.`,
      cta: 'إدارة الوظيفة',
      labelJob: 'الوظيفة',
      labelExpires: 'ينتهي في',
      labelApplicants: 'المتقدمين',
    },

    jobExpired: {
      subject: (job: string) => `انتهت مدة «${job}»`,
      preheader: 'الإعلان وقف عن الظهور.',
      heading: 'انتهت مدة الإعلان',
      body: (job: string) =>
        `«${job}» خلص مدته ووقف عن الظهور في نتايج البحث. المتقدمين اللي وصلوك لسه موجودين في لوحة التحكم.`,
      cta: 'انشر الإعلان تاني',
      labelJob: 'الوظيفة',
      labelExpired: 'انتهى في',
      labelApplicants: 'إجمالي المتقدمين',
    },

    // -----------------------------------------------------------------------
    // Company
    // -----------------------------------------------------------------------

    accountApproved: {
      subject: 'حسابك اتفعّل',
      preheader: 'تقدر تنشر إعلاناتك دلوقتي.',
      heading: 'حسابك اتفعّل',
      body: 'راجعنا بيانات شركتك، والحساب بقى مفعّل. تقدر تنشر أول إعلان دلوقتي.',
      cta: 'انشر وظيفة',
    },

    accountRejected: {
      subject: 'حسابك متوقف مؤقتاً',
      preheader: 'محتاجين نراجع بيانات الشركة تاني.',
      heading: 'حسابك متوقف مؤقتاً',
      body: 'وقّفنا الحساب مؤقتاً لحد ما نراجع البيانات تاني.',
      reason: (note: string) => `السبب: ${note}`,
      contact: 'لو ده مش صح، ابعتلنا من صفحة المساعدة وهنراجعها.',
    },

    companyCreated: {
      subject: 'اتعمل حساب شركتك',
      preheader: 'كمّل بيانات الشركة عشان تنشر.',
      heading: 'حساب شركتك جاهز',
      body: (company: string) =>
        `سجّلنا «${company}». كمّل البيانات والمستندات عشان نوثّق الحساب — الشركات الموثّقة بيظهر عليها علامة توثيق وبتوصل لمستشارين أكتر.`,
      cta: 'كمّل بيانات الشركة',
      labelCompany: 'الشركة',
    },

    companyVerified: {
      subject: 'تم توثيق شركتك',
      preheader: 'علامة التوثيق ظهرت على صفحتك.',
      heading: 'شركتك اتوثّقت',
      body: (company: string) =>
        `راجعنا مستندات «${company}» وكل حاجة تمام. علامة التوثيق ظهرت على صفحة الشركة وعلى كل إعلاناتك، وبقيت تقدر تشوف ملفات المستشارين اللي مخصّصة للشركات الموثّقة.`,
      cta: 'اعرض صفحة الشركة',
      labelCompany: 'الشركة',
    },

    companyVerificationNeeded: {
      subject: 'مطلوب إجراء لاستكمال توثيق شركتك',
      preheader: 'ناقص مستندات على طلب التوثيق.',
      heading: 'التوثيق محتاج إجراء منك',
      body: (company: string) =>
        `مراجعة مستندات «${company}» ماكمّلتش. محتاجين السجل التجاري والبطاقة الضريبية بصورة واضحة وسارية.`,
      reason: (note: string) => `الملاحظة: ${note}`,
      cta: 'استكمل البيانات',
      labelCompany: 'الشركة',
    },

    // -----------------------------------------------------------------------
    // Optional
    // -----------------------------------------------------------------------

    digest: {
      subject: (count: number, label: string) =>
        count === 1 ? `وظيفة جديدة في «${label}»` : `${count} وظايف جديدة في «${label}»`,
      preheader: 'وظايف جديدة تطابق البحث المحفوظ عندك.',
      heading: 'في جديد في بحثك',
      body: (label: string) => `دي الوظايف اللي نزلت الأسبوع ده وبتطابق «${label}».`,
      cta: 'شوفهم كلهم',
      labelSearch: 'البحث',
    },

    applicantDigest: {
      subject: (count: number) =>
        count === 1 ? 'عندك متقدم جديد' : `عندك ${count} متقدمين جدد`,
      preheader: 'ملخّص المتقدمين النهارده.',
      heading: 'متقدمين جدد',
      body: (count: number) =>
        count === 1
          ? 'وصلك متقدم جديد من آخر مرة بعتنالك.'
          : `وصلك ${count} متقدمين جدد من آخر مرة بعتنالك.`,
      cta: 'شوف المتقدمين',
    },

    status: {
      new: 'جديد',
      shortlisted: 'في القائمة المختصرة',
      interview: 'مقابلة',
      hired: 'اتقبل',
      rejected: 'مش مناسب',
    } satisfies Record<ApplicationStatus, string>,
  },

  en: {
    siteName: 'Brokers Connect',

    footer: {
      automated: 'This is an automated message. Please do not reply to this email.',
      reasonAccount: 'You are receiving this because you have a Brokers Connect account.',
      reasonOptional: 'You are receiving this because email notifications are on.',
      privacy: 'Privacy',
      terms: 'Terms',
      help: 'Need a hand? Write to us at',
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
      preheader: 'The company no longer sees it.',
      heading: 'Application withdrawn',
      body: (job: string) =>
        `Your application for "${job}" has been withdrawn and the company can no longer see it. You can apply again at any time while the listing is open.`,
      cta: 'Browse roles',
      labelJob: 'Role',
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

    companyCreated: {
      subject: 'Your company account is set up',
      preheader: 'Complete the details to publish.',
      heading: 'Your company account is ready',
      body: (company: string) =>
        `"${company}" is registered. Complete the details and documents so we can verify the account — verified companies carry a badge and reach more consultants.`,
      cta: 'Complete company details',
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

    digest: {
      subject: (count: number, label: string) =>
        count === 1 ? `A new role matching "${label}"` : `${count} new roles matching "${label}"`,
      preheader: 'New roles matching your saved search.',
      heading: 'New in your search',
      body: (label: string) => `These went up this week and match "${label}".`,
      cta: 'See them all',
      labelSearch: 'Search',
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
    } satisfies Record<ApplicationStatus, string>,
  },
} as const;

export function copyFor(locale: string | null | undefined) {
  return locale === 'en' ? emailCopy.en : emailCopy.ar;
}

export function localeOf(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'ar';
}
