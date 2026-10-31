import { commissionNote } from '~/components/jobs/compensation-card';

describe('the commission note on the pay card', () => {
  it('gives only the terms when the note opens with the rate the tile shows', () => {
    expect(commissionNote('عمولة 1.5٪ من قيمة الوحدة.', 1.5)).toEqual({ terms: 'من قيمة الوحدة', full: null });
    expect(commissionNote('العمولة ١٫٥٪ من قيمة الوحدة', 1.5)).toEqual({ terms: 'من قيمة الوحدة', full: null });
    expect(commissionNote('2% من قيمة البيع', 2)).toEqual({ terms: 'من قيمة البيع', full: null });
  });

  it('says nothing more when the note is only the rate', () => {
    expect(commissionNote('عمولة 1.5٪.', 1.5)).toEqual({ terms: null, full: null });
  });

  it('keeps a note that says something else, whole and below the tiles', () => {
    expect(commissionNote('تُصرف العمولة بعد التعاقد.', 1.5)).toEqual({ terms: null, full: 'تُصرف العمولة بعد التعاقد.' });
    expect(commissionNote('عمولة 3٪ من قيمة الوحدة', 1.5)).toEqual({ terms: null, full: 'عمولة 3٪ من قيمة الوحدة' });
    expect(commissionNote('عمولة ثابتة لكل صفقة', null)).toEqual({ terms: null, full: 'عمولة ثابتة لكل صفقة' });
  });

  it('puts long terms below the tiles rather than in a third of the card', () => {
    const long = 'من قيمة الوحدة، تُصرف بعد استلام الدفعة الأولى من العميل وتوقيع العقد';
    expect(commissionNote(`عمولة 1.5٪ ${long}`, 1.5)).toEqual({ terms: null, full: long });
  });

  it('shows nothing for no note', () => {
    expect(commissionNote(null, 1.5)).toEqual({ terms: null, full: null });
    expect(commissionNote('  ', 1.5)).toEqual({ terms: null, full: null });
  });
});
