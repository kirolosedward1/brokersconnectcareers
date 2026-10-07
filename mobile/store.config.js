/**
 * The App Store listing, in Arabic and English: what App Store Connect shows
 * and asks about the app, read by EAS Metadata (eas.json,
 * submit.production.ios.metadataPath). From this folder,
 * `npx eas-cli@latest metadata:lint` checks it without signing in, and
 * `npx eas-cli@latest metadata:push` writes it to App Store Connect.
 * docs/app-store.md says where each answer comes from.
 *
 * What it claims is what the code does: a listing goes live only through
 * moderation (guard_job_update), every listing names its lead source
 * (jobs.leads_source is not null), candidates pay nothing, and the app speaks
 * Arabic while the website's ENGLISH_ENABLED is off (src/lib/locale.ts). Change
 * the words here when one of those changes.
 *
 * The reviewer's contact and the two review accounts are not written here: the
 * repository is public. The one push that needs them reads them from its
 * environment (APP_REVIEW_*, docs/app-store.md); without any of them, App
 * Store Connect keeps the review details it has.
 */

const SITE = 'https://www.brokersconnect.net';

/** src/lib/business.ts, OPERATOR.name; tests/store-config.test.ts keeps the two equal. */
const OPERATOR = 'Top Suite Digital Marketing';

const REVIEW_CONTACT = {
  firstName: 'APP_REVIEW_CONTACT_FIRST_NAME',
  lastName: 'APP_REVIEW_CONTACT_LAST_NAME',
  email: 'APP_REVIEW_CONTACT_EMAIL',
  phone: 'APP_REVIEW_CONTACT_PHONE',
};
const REVIEW_ACCOUNTS = {
  candidateEmail: 'APP_REVIEW_CANDIDATE_EMAIL',
  candidatePassword: 'APP_REVIEW_CANDIDATE_PASSWORD',
  employerEmail: 'APP_REVIEW_EMPLOYER_EMAIL',
  employerPassword: 'APP_REVIEW_EMPLOYER_PASSWORD',
};

const descriptionAr = `بروكرز كونكت منصة وظائف ودليل استشاريين متخصصة في التسويق العقاري في مصر.

للاستشاريين العقاريين والسماسرة
• وظائف البيع والتسويق العقاري في كل مصر، بفلاتر للمنطقة والتخصص ومصدر العملاء والراتب والعمولة وسنوات الخبرة.
• بنطلب من كل شركة الراتب الأساسي والعمولة بالأرقام، وكل إعلان بيقول مين اللي بيوفّر العملاء.
• قدّم بسيرتك الذاتية وتابع كل طلب: هتعرف إمتى الشركة فتحته، وإمتى نقلتك للقائمة المختصرة أو للمقابلة.
• احفظ الوظائف وعمليات البحث، وتابع الشركات، ويوصلك إشعار لما تنزل وظائف جديدة تناسبك.
• بروفايلك في دليل الاستشاريين — مناطقك، والمطورين اللي بعت مشاريعهم، وسجل مبيعاتك، وسيرتك الذاتية — عشان الشركات المعتمدة على المنصة توصلّك. وانت اللي بتقرر يظهر ولا لأ.
• من غير رسوم على الباحثين عن عمل.

لشركات العقارات
• انشر وظيفتك بالراتب والعمولة ومصدر العملاء بوضوح. كل إعلان بيتراجع قبل ما ينزل.
• كل المتقدمين في مكان واحد — جديد، قائمة مختصرة، مقابلة، تم التعيين — مع ملاحظات خاصة لفريقك، والسيرة الذاتية على بُعد لمسة.
• دوّر في دليل الاستشاريين واحتفظ بقائمة المرشحين.
• وثّق شركتك بالسجل التجاري والبطاقة الضريبية عشان تاخد علامة «موثّقة».
• ضيف زمايلك يديروا الإعلانات والمتقدمين معاك.

الأمان
• الإعلانات اللي بتطلب من المتقدمين فلوس، أو بيانات بطاقة أو حساب بنكي قبل المقابلة، بتتشال.
• تقدر تبلّغ عن أي إعلان أو شركة أو بروفايل من جوه التطبيق.`;

const descriptionEn = `Brokers Connect is a job board and consultant directory for real estate sales in Egypt. The app is in Arabic.

FOR SALES CONSULTANTS AND BROKERS
• Real estate sales and brokerage jobs across Egypt, with filters for area, track, lead source, salary, commission and experience.
• Companies are asked for the basic salary and the commission in figures, and every listing says who supplies the leads.
• Apply with your CV, then follow each application: you see when the company opens it, and when it moves you to the shortlist or to an interview.
• Save jobs and searches, follow companies, and get notified when new jobs match.
• A profile in the consultant directory — your areas, the developers you have sold for, your sales record and your CV — that companies approved on Brokers Connect can find. You decide whether it is shown.
• No fees for candidates.

FOR REAL ESTATE COMPANIES
• Post a job with the salary, the commission and the lead source spelled out. Every listing is reviewed before it goes live.
• Applicants in one pipeline — new, shortlisted, interview, hired — with private notes for your team and each CV a tap away.
• Search the consultant directory and keep a shortlist.
• Verify your company with its commercial register and tax card to show the verified badge.
• Bring your colleagues in to manage listings and applicants with you.

SAFETY
• Listings that ask candidates for money, or for ID or bank details before an interview, are taken down.
• Report any listing, company or profile from inside the app.`;

/** What App Review reads besides the accounts: Apple reviews in English. */
function reviewNotes(employerEmail, employerPassword) {
  return `Brokers Connect is a job board and consultant directory for Egypt's real estate market. The app is in Arabic: the labels to tap are quoted as the app shows them, with their meaning in brackets.

CANDIDATE ACCOUNT (the sign-in above)
• Tabs: «الرئيسية» (Home), «الوظائف» (Jobs), «طلباتي» (My applications), «المحفوظات» (Saved), «حسابي» (Account).
• Apply: at the bottom of «الرئيسية», tap «شركات العقارات» (Real estate companies), then the company «حساب مراجعة التطبيق» (App Review account), then its listing «مدير مبيعات (إعلان لمراجعة التطبيق)» (Sales manager, app review listing), and apply. The same listing: ${SITE}/jobs/app-review-sales-manager. The application then shows under «طلباتي». This account has already applied to the company's other listing; that application is the employer account's applicant.
• The directory profile is «ملفي» (My profile), under «حسابي».

EMPLOYER ACCOUNT: ${employerEmail} / ${employerPassword}
• Tabs: «الرئيسية» (Home), «إعلاناتي» (My listings), «المتقدمين» (Applicants), «الاستشاريين» (Consultants), «حسابي» (Account).
• «إعلاناتي»: post a job. A new listing, and a live one whose title, pay or terms are edited, waits for our moderators before it shows, so please edit after trying the candidate part.
• «المتقدمين»: move the applicant through the stages, add a private note, and open the CV.
• «الاستشاريين»: the consultants who chose to be shown to companies. It can be short while the service is new; the review candidate is kept out of it.

USER-GENERATED CONTENT
• Report: «بلّغ عن الإعلان» (Report the listing) on a listing, «بلّغ عن الشركة» (Report the company) on a company's page, «بلّغ عن الملف» (Report the profile) on a consultant's profile. Reports go to our moderators.
• Hide: «اخفي الشركة دي» (Hide this company) on a company's page and, for a company, «اخفي الاستشاري ده» (Hide this consultant) on a consultant's profile. Both come back from «مخفي على الموبايل ده» (Hidden on this phone), under «حسابي».
• A new account agrees to the Terms, and confirms being 18 or over, before it can go on (sign up with an address you can receive mail at to see it). The two review accounts have already agreed.

DELETING THE ACCOUNT
«حسابي» > «حذف الحساب» (Delete account): type «حذف», or the English word delete, then tap «احذف حسابي نهائياً» (Delete my account permanently). Please try it last: deleting the candidate deletes its applications, which are the employer's applicants. The employer account owns the review company, so for it the same screen sends a deletion request instead: deleting it would delete other people's applications to the company's listings.

Nothing is sold in the app.`;
}

/**
 * The review section, or nothing when none of its variables is set. Some but
 * not all is a mistake worth stopping for: a push would replace what App Store
 * Connect has with half of it.
 */
function review(env) {
  const names = [...Object.values(REVIEW_CONTACT), ...Object.values(REVIEW_ACCOUNTS)];
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length === names.length) return undefined;
  if (missing.length > 0) {
    throw new Error(`store.config.js: the review details need every APP_REVIEW_ variable; missing ${missing.join(', ')}`);
  }
  const value = (name) => env[name].trim();
  return {
    firstName: value(REVIEW_CONTACT.firstName),
    lastName: value(REVIEW_CONTACT.lastName),
    email: value(REVIEW_CONTACT.email),
    phone: value(REVIEW_CONTACT.phone),
    demoUsername: value(REVIEW_ACCOUNTS.candidateEmail),
    demoPassword: value(REVIEW_ACCOUNTS.candidatePassword),
    demoRequired: true,
    notes: reviewNotes(value(REVIEW_ACCOUNTS.employerEmail), value(REVIEW_ACCOUNTS.employerPassword)),
  };
}

function storeConfig(env = process.env) {
  const reviewDetails = review(env);
  return {
    configVersion: 0,
    apple: {
      // The App Store version the listing is for: the build's own (app.config.ts),
      // or App Store Connect opens 1.0 and offers it no 1.0.0 build.
      version: '1.0.0',
      copyright: `2026 ${OPERATOR}`,
      categories: ['BUSINESS'],
      info: {
        'ar-SA': {
          title: 'بروكرز كونكت',
          subtitle: 'وظائف العقارات في مصر',
          description: descriptionAr,
          // 100 bytes at most, and an Arabic letter is two: وظائف and مصر are in the
          // subtitle, which App Store search reads as well.
          keywords: ['سمسار', 'استشاري عقاري', 'تسويق عقاري', 'مبيعات', 'توظيف', 'عقارات'],
          promoText: 'وظائف البيع والتسويق العقاري في كل مصر. كل إعلان بيقول مين اللي بيوفّر العملاء.',
          marketingUrl: SITE,
          supportUrl: SITE,
          privacyPolicyUrl: `${SITE}/privacy`,
          privacyChoicesUrl: `${SITE}/account-deletion`,
        },
        'en-US': {
          title: 'Brokers Connect',
          subtitle: 'Real estate jobs in Egypt',
          description: descriptionEn,
          keywords: ['real estate', 'jobs', 'property consultant', 'sales', 'Egypt', 'hiring', 'careers', 'New Cairo', 'Sheikh Zayed', 'commission'],
          promoText: 'Real estate sales jobs across Egypt. Every listing says who supplies the leads.',
          marketingUrl: SITE,
          supportUrl: SITE,
          privacyPolicyUrl: `${SITE}/privacy?lang=en`,
          privacyChoicesUrl: `${SITE}/account-deletion?lang=en`,
        },
      },
      // The Terms and the Privacy policy are for people aged 18 and over, and
      // onboarding asks for that; the content answers alone would rate it 4+.
      advisory: {
        alcoholTobaccoOrDrugUseOrReferences: 'NONE',
        contests: 'NONE',
        gamblingSimulated: 'NONE',
        gunsOrOtherWeapons: 'NONE',
        horrorOrFearThemes: 'NONE',
        matureOrSuggestiveThemes: 'NONE',
        medicalOrTreatmentInformation: 'NONE',
        profanityOrCrudeHumor: 'NONE',
        sexualContentGraphicAndNudity: 'NONE',
        sexualContentOrNudity: 'NONE',
        violenceCartoonOrFantasy: 'NONE',
        violenceRealistic: 'NONE',
        violenceRealisticProlongedGraphicOrSadistic: 'NONE',
        gambling: false,
        lootBox: false,
        advertising: false,
        // Onboarding asks people to confirm they are 18 or over; nothing
        // verifies or estimates an age.
        ageAssurance: false,
        healthOrWellnessTopics: false,
        // Contacting an applicant opens WhatsApp; nothing is sent inside the app.
        messagingAndChat: false,
        parentalControls: false,
        // Listings, company pages and consultant profiles, all reportable.
        userGeneratedContent: true,
        // The in-app browser opens the pages the app names (the website's, a
        // licence's text, the captcha's own links) and has no address bar.
        unrestrictedWebAccess: false,
        kidsAgeBand: null,
        ageRatingOverride: 'NONE',
        ageRatingOverrideV2: 'EIGHTEEN_PLUS',
        koreaAgeRatingOverride: 'NONE',
      },
      // Released by hand once approved, so the moment it goes live is chosen.
      release: { automaticRelease: false },
      ...(reviewDetails ? { review: reviewDetails } : {}),
    },
  };
}

module.exports = () => storeConfig();
module.exports.storeConfig = storeConfig;
