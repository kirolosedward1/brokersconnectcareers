import { isApplePrivateRelay, suggestedDisplayName } from '@/lib/auth/suggested-name';

const relay = 'xq7k2m9p4t@privaterelay.appleid.com';

describe('a name onboarding may offer', () => {
  it('keeps a name Apple shared', () => {
    expect(suggestedDisplayName({ metadata: { full_name: 'سارة عادل' }, email: relay, providers: ['apple'] })).toBe('سارة عادل');
    expect(suggestedDisplayName({ metadata: { name: 'Sara Adel' }, email: 'sara@icloud.com', providers: ['apple'] })).toBe('Sara Adel');
    expect(
      suggestedDisplayName({ metadata: { name: { firstName: 'سارة', lastName: 'عادل' } }, email: relay, providers: ['apple'] }),
    ).toBe('سارة عادل');
    expect(suggestedDisplayName({ metadata: { given_name: 'Sara', family_name: 'Adel' }, email: relay, providers: ['apple'] })).toBe(
      'Sara Adel',
    );
  });

  it('asks when Apple sent no name, and never uses a private-relay address', () => {
    expect(suggestedDisplayName({ metadata: {}, email: 'sara@icloud.com', providers: ['apple'] })).toBe('');
    expect(suggestedDisplayName({ metadata: { full_name: '   ' }, email: relay, providers: ['apple'] })).toBe('');
    expect(suggestedDisplayName({ metadata: { full_name: 'xq7k2m9p4t' }, email: relay, providers: ['apple'] })).toBe('');
    expect(suggestedDisplayName({ metadata: {}, email: relay, providers: ['email'] })).toBe('');
    expect(suggestedDisplayName({ metadata: { full_name: relay }, email: relay, providers: ['apple'] })).toBe('');
  });

  it('still offers the local part of an ordinary address', () => {
    expect(suggestedDisplayName({ metadata: {}, email: 'sara.adel@gmail.com', providers: ['email'] })).toBe('sara.adel');
    expect(isApplePrivateRelay('A@PrivateRelay.AppleID.com')).toBe(true);
    expect(isApplePrivateRelay('sara@icloud.com')).toBe(false);
  });
});
