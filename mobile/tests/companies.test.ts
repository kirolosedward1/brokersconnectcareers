import type { CompanyListResponse } from '@/lib/mobile-api/reads';
import type { CompanyListItem } from '@/lib/read-types';
import { companySearch, flattenCompanies } from '~/features/companies/queries';

describe('companySearch', () => {
  it("asks exactly what the website's form asks", () => {
    expect(companySearch({ q: '  نايل ', district: 'new-cairo', verified: true }, 2)).toBe(
      `q=${encodeURIComponent('نايل')}&district=new-cairo&verified=1&page=2`,
    );
    expect(companySearch({ q: '', district: null, verified: false })).toBe('');
  });

  it('bounds the words as the server does', () => {
    const long = 'a'.repeat(300);
    expect(new URLSearchParams(companySearch({ q: long, district: null, verified: false })).get('q')).toHaveLength(120);
  });
});

describe('flattenCompanies', () => {
  it('lists each company once', () => {
    const company = (id: string) => ({ id }) as CompanyListItem;
    const page = (n: number, ids: string[]): CompanyListResponse => ({
      companies: ids.map(company),
      total: 3,
      page: n,
      pageCount: 2,
    });
    expect(flattenCompanies([page(1, ['a', 'b']), page(2, ['b', 'c'])]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
