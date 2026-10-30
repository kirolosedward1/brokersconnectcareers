import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { accountTabIcon } from '~/components/navigation/tab-bar';
import { CircleUserRound } from '~/components/ui/lucide';
import { env } from '~/lib/env';
import { useSession } from '~/lib/session';
import { ThemeProvider } from '~/theme/provider';

/*
  The Account tab's icon: signed in, the reader's own photo once they have
  put one on their account, ringed in the open tab's colour while it is open,
  and the generic person's silhouette otherwise — and when the photo will not
  load. Signed out, the person's icon.
*/

jest.mock('~/lib/session', () => ({ useSession: jest.fn() }));

// The project's own storage, wherever the tests are pointed (CI names the real project).
const OWN_PHOTO = `${env.supabaseUrl}/storage/v1/object/public/avatars/8b7c7f1e-0000-4000-8000-000000000001/photo.webp`;
const Icon = accountTabIcon({ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }, CircleUserRound);

const wrapper = ThemeProvider;

function signedInWith(avatarUrl: string | null) {
  jest.mocked(useSession).mockReturnValue({ viewer: { profile: { avatar_url: avatarUrl } } } as unknown as ReturnType<typeof useSession>);
}

it("is the reader's own photo when they have one, ringed while the tab is open", () => {
  signedInWith(OWN_PHOTO);
  const view = render(<Icon focused color="#16295A" size={24} />, { wrapper });
  const photo = screen.getByTestId('tab-photo');
  expect(StyleSheet.flatten(photo.props.style)).toEqual(expect.objectContaining({ borderColor: '#16295A' }));
  // Not open: no ring, the photo the same size.
  view.rerender(<Icon focused={false} color="#5C6270" size={24} />);
  expect(StyleSheet.flatten(screen.getByTestId('tab-photo').props.style)).toEqual(expect.objectContaining({ borderWidth: 0 }));
});

it("is the generic silhouette without one, with one from anywhere but the site's own storage, or when it will not load", () => {
  signedInWith(null);
  const view = render(<Icon focused color="#16295A" size={24} />, { wrapper });
  expect(screen.queryByTestId('tab-photo')).toBeNull();
  expect(screen.getByTestId('tab-silhouette')).toBeTruthy();

  // Somebody else's host: not fetched (src/lib/avatar-url.ts).
  signedInWith('https://tracker.example/storage/v1/object/public/avatars/x/photo.webp');
  view.rerender(<Icon focused color="#16295A" size={24} />);
  expect(screen.queryByTestId('tab-photo')).toBeNull();
  expect(screen.getByTestId('tab-silhouette')).toBeTruthy();

  signedInWith(OWN_PHOTO);
  view.rerender(<Icon focused color="#16295A" size={24} />);
  const image = screen.getByTestId('tab-photo').props.children;
  fireEvent(screen.UNSAFE_getByProps({ recyclingKey: OWN_PHOTO }), 'error');
  expect(image).toBeTruthy();
  expect(screen.queryByTestId('tab-photo')).toBeNull();
  expect(screen.getByTestId('tab-silhouette')).toBeTruthy();
});

it("is the person's icon while signed out", () => {
  jest.mocked(useSession).mockReturnValue({ viewer: null } as unknown as ReturnType<typeof useSession>);
  render(<Icon focused color="#16295A" size={24} />, { wrapper });
  expect(screen.queryByTestId('tab-photo')).toBeNull();
  expect(screen.queryByTestId('tab-silhouette')).toBeNull();
});
