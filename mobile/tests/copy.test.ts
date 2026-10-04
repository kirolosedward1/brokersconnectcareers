import { createTranslator } from 'use-intl';
import { employerToAgentOpener } from '@/lib/whatsapp';
import { catalogues } from '~/i18n/provider';

/*
  What the words say, read the way the phone formats them: counts in their
  plural forms, one name for one thing, no promise the code does not keep,
  and examples that stay in reading order inside Arabic.
*/

const ar = createTranslator({ locale: 'ar', messages: catalogues.ar });
const en = createTranslator({ locale: 'en', messages: catalogues.en });
const LRI = '⁦';
const PDI = '⁩';

/** Every string in a catalogue, with its key. */
function strings(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    strings(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('a count', () => {
  it('takes its plural, in both languages', () => {
    expect(ar('jobs.views', { count: 1 })).toBe('مشاهدة واحدة');
    expect(ar('jobs.views', { count: 2 })).toBe('مشاهدتين');
    expect(ar('jobs.views', { count: 3 })).toBe('3 مشاهدات');
    expect(ar('jobs.views', { count: 11 })).toBe('11 مشاهدة');
    expect(en('jobs.views', { count: 1 })).toBe('1 view');
    expect(en('jobs.views', { count: 1200 })).toBe('1,200 views');

    expect(ar('agents.unitsClosedShort', { count: 1 })).toBe('وحدة واحدة مباعة');
    expect(ar('agents.unitsClosedShort', { count: 5 })).toBe('5 وحدات مباعة');
    expect(en('agents.unitsClosedShort', { count: 1 })).toBe('1 unit closed');

    expect(ar('filters.minYears', { count: 1 })).toBe('خبرة سنة أو أكتر');
    expect(ar('filters.minYears', { count: 3 })).toBe('خبرة 3 سنين أو أكتر');

    const pipeline = (t: typeof ar, count: number) => t.markup('employer.pipelineCount', { count, v: (chunks) => chunks });
    expect(pipeline(en, 1)).toBe('1 applicant');
    expect(pipeline(en, 4)).toBe('4 applicants');
    expect(pipeline(ar, 4)).toBe('4 متقدمين');
    expect(pipeline(ar, 12)).toBe('12 متقدم');

    expect(ar('notifications.unreadCount', { count: 1 })).toBe('تنبيه واحد غير مقروء');
    expect(ar('notifications.applicationReceivedMany', { count: 2, subject: 'مستشار مبيعات' })).toBe(
      'متقدمين اتنين جداد على مستشار مبيعات',
    );
  });

  it('is said once where the number is already in front of the word', () => {
    // "2 وظيفتان خاليتان" said two twice.
    expect(`2 ${ar('jobs.seatsLabel', { count: 2 })}`).toBe('2 وظيفة خالية');
    expect(ar('employer.duplicateBody', { title: 'مستشار مبيعات', seats: 1 })).toContain('لسه فيه وظيفة خالية واحدة.');
  });
});

describe('one name for one thing', () => {
  const arabic = strings(catalogues.ar);

  it('calls open seats "وظائف خالية" everywhere', () => {
    expect(arabic.filter(([, text]) => /شاغر|شواغر|عدد الأماكن/.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('spells وظائف one way, as the board writes it beside its empty state', () => {
    expect(arabic.filter(([, text]) => text.includes('وظايف')).map(([key]) => key)).toEqual([]);
  });

  it('says "كلمة المرور", never "كلمة السر"', () => {
    expect(arabic.filter(([, text]) => text.includes('كلمة السر')).map(([key]) => key)).toEqual([]);
  });

  it('names the visibility choice as its own option does, wherever it is quoted', () => {
    const label = catalogues.ar.visibility.verified_employers_only;
    expect(catalogues.ar.agents.ownerVerified).toContain(`«${label}»`);
    expect(catalogues.en.agents.ownerVerified).toContain(`“${catalogues.en.visibility.verified_employers_only}”`);
    expect(catalogues.en.agents.ownerPublic).toContain(`“${catalogues.en.visibility.public}”`);
  });

  it('opens a WhatsApp chat from the directory by its name', () => {
    const opener = employerToAgentOpener({ agentName: 'سارة', companyName: 'نايل بروكرز', locale: 'ar' });
    expect(opener).toContain('دليل الاستشاريين');
    expect(employerToAgentOpener({ agentName: 'Sara', companyName: 'Nile', locale: 'en' })).toContain('consultant directory');
  });
});

describe('a promise', () => {
  it('names what sends a live listing back to review, as the database decides it (migration 344)', () => {
    const note = en('jobForm.liveEditNote');
    for (const field of ['Arabic title or description', 'track', 'district', 'employment type', 'experience required', 'salary', 'commission', 'leads source', 'open seats']) {
      expect(note.split('Everything else')[0]).toContain(field);
    }
    expect(note.split('Everything else')[1]).toContain('requirements');
  });

  it('offers no renewal before a listing ends, which nothing does', () => {
    expect(en('dashboard.nextExpiringBody')).not.toMatch(/renew/i);
    expect(ar('dashboard.nextExpiringBody')).not.toContain('تجدّده');
  });

  it('says alerts come once a day and on Mondays by email, not "as soon as"', () => {
    for (const key of ['companies.followHint', 'companies.followingHint', 'jobs.emptySaveHint'] as const) {
      expect(en(key)).toContain('once a day');
      expect(ar(key)).toContain('مرة في اليوم');
    }
  });

  it('promises no push when a company opens an application, which has no notification', () => {
    expect(catalogues.en.app.push.hintCandidate).not.toMatch(/opens/);
  });

  it('suggests following a company with no roles only to whoever can follow it', () => {
    expect(ar('companies.noOpenRoles', { follow: 'yes' })).toContain('تابعها');
    expect(ar('companies.noOpenRoles', { follow: 'no' })).not.toContain('تابعها');
    expect(en('companies.noOpenRoles', { follow: 'no' })).toBe('This company has no open roles right now.');
  });
});

describe('an example inside Arabic', () => {
  it('stays in reading order: the number, the address and the month are isolated left to right', () => {
    expect(ar('validation.invalidPhone')).toContain(`${LRI}+201001234567${PDI}`);
    expect(ar('validation.invalidUrl')).toContain(`${LRI}https://${PDI}`);
    expect(ar('app.profile.monthInvalid')).toContain(`${LRI}2024-03${PDI}`);
  });

  it('marks the word to type to delete an account, which the app draws without bold', () => {
    expect(ar.markup('account.deleteConfirmLabel', { word: 'حذف', b: (chunks) => chunks })).toBe('اكتب «حذف» عشان تأكّد.');
  });
});
