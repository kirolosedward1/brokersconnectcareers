import { Button } from '@/components/ui/button';

/**
 * Sign in with Apple, in Apple's own layout.
 *
 * The mark is Apple's medium logo sheet from the Sign in with Apple design
 * resources (public/brand/apple-sign-in), used as shipped — not redrawn.
 * Apple's button crops that 31×44 sheet to the 17-wide mark in the middle
 * (offset 7) and draws it at the full button height. Black sheet on a light
 * page, white sheet in the dark theme. The control itself is the same height,
 * corner radius and width as the Google button beside it (`size="lg"`,
 * `w-full max-w-full min-w-0`, `rounded-lg`). Below 360px the side padding
 * is 12px, so the label stays on one line without widening the column.
 */
const BUTTON_HEIGHT = '3rem';
const MARK_WIDTH = `calc(${BUTTON_HEIGHT} * 17 / 44)`;
const SHEET_WIDTH = `calc(${BUTTON_HEIGHT} * 31 / 44)`;
const SHEET_CROP = `calc(${BUTTON_HEIGHT} * -7 / 44)`;

function AppleMark() {
  const shared = {
    alt: '',
    draggable: false,
    width: 31,
    height: 44,
  } as const;

  return (
    <span aria-hidden className="relative inline-block h-12 shrink-0 overflow-hidden" style={{ width: MARK_WIDTH }}>
      <img
        {...shared}
        src="/brand/apple-sign-in/left-white-logo-medium.svg"
        className="pointer-events-none absolute top-0 h-12 max-w-none dark:hidden"
        style={{ width: SHEET_WIDTH, insetInlineStart: SHEET_CROP }}
      />
      <img
        {...shared}
        src="/brand/apple-sign-in/left-black-logo-medium.svg"
        className="pointer-events-none absolute top-0 hidden h-12 max-w-none dark:block"
        style={{ width: SHEET_WIDTH, insetInlineStart: SHEET_CROP }}
      />
    </span>
  );
}

export function AppleSignInButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="lg"
      className="w-full max-w-full min-w-0 whitespace-nowrap border-0 bg-[#000000] px-3 text-white shadow-none hover:bg-[#000000] hover:opacity-[0.92] min-[360px]:px-6 dark:bg-[#ffffff] dark:text-black dark:hover:bg-[#ffffff]"
      disabled={disabled}
      onClick={onClick}
    >
      <AppleMark />
      <span className="min-w-0 whitespace-nowrap">{label}</span>
    </Button>
  );
}
