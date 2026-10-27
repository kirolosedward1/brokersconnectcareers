'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ConfirmAction, type AdminLever } from '@/components/admin/confirm-action';
import { Button } from '@/components/ui/button';
import { WhatsAppMark } from '@/components/brand-marks';
import { revealContact } from '@/lib/actions/admin';
import { isAdminErrorCode } from '@/lib/admin/errors';
import { cn, whatsappLink } from '@/lib/utils';

type Tone = 'default' | 'destructive' | 'success';

type Shared = {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Shown as an icon on a wide screen. Every action is in the ⋯ menu. */
  primary?: boolean;
  tone?: Tone;
};

export type RowAction =
  | (Shared & { kind: 'link'; href: string })
  | (Shared & {
      kind: 'lever';
      lever: AdminLever;
      title: string;
      body?: string;
      reason?: 'optional' | 'none' | 'required';
      reasonLabel?: string;
    })
  | (Shared & { kind: 'contact'; userId: string; channel: 'email' | 'whatsapp' });

const TONE: Record<Tone, 'outline' | 'destructive' | 'success'> = {
  default: 'outline',
  destructive: 'destructive',
  success: 'success',
};

/**
 * The few things an admin does without opening the page.
 *
 * Icons on a wide screen, every one of them again in the ⋯ menu, and on a
 * phone only the menu — a row of six buttons does not fit a card. Each lever
 * is the same confirmation the detail page uses, reason optional.
 */
export function RowActions({ actions }: { actions: RowAction[] }) {
  const t = useTranslations('admin');
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (actions.length === 0) return null;

  const primary = actions.filter((action) => action.primary);

  return (
    <div
      ref={root}
      className="relative z-20 flex items-center justify-end gap-0.5"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="hidden items-center gap-0.5 md:flex">
        {primary.map((action) => (
          <ActionView key={action.id} action={action} chrome="icon" onContactError={setContactError} />
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('moreActions')}
        title={t('moreActions')}
        onClick={() => {
          setContactError(null);
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal aria-hidden />
      </Button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 top-full z-30 mt-1 min-w-52 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {actions.map((action) => (
            <ActionView key={action.id} action={action} chrome="menu" onDone={() => setOpen(false)} onContactError={setContactError} />
          ))}
          {contactError ? (
            <p role="alert" className="px-3 py-2 text-xs text-destructive">
              {contactError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActionView({
  action,
  chrome,
  onDone,
  onContactError,
}: {
  action: RowAction;
  chrome: 'icon' | 'menu';
  onDone?: () => void;
  onContactError: (message: string | null) => void;
}) {
  const variant = TONE[action.tone ?? 'default'];

  if (action.kind === 'link') {
    const className =
      chrome === 'icon'
        ? 'relative z-10 grid size-8 place-items-center rounded-md border border-border bg-card hover:bg-muted'
        : 'relative z-10 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-sm hover:bg-muted';
    return (
      <Link
        href={action.href}
        title={chrome === 'icon' ? action.label : undefined}
        aria-label={action.label}
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          onDone?.();
        }}
      >
        {action.icon}
        {chrome === 'icon' ? <span className="sr-only">{action.label}</span> : action.label}
      </Link>
    );
  }

  if (action.kind === 'contact') {
    return <ContactButton action={action} chrome={chrome} onDone={onDone} onError={onContactError} />;
  }

  return (
    <ConfirmAction
      lever={action.lever}
      label={action.label}
      title={action.title}
      body={action.body}
      reason={action.reason ?? 'optional'}
      reasonLabel={action.reasonLabel}
      variant={variant}
      icon={action.icon}
      chrome={chrome}
      className={cn(chrome === 'menu' && 'font-normal')}
    />
  );
}

function ContactButton({
  action,
  chrome,
  onDone,
  onError,
}: {
  action: Extract<RowAction, { kind: 'contact' }>;
  chrome: 'icon' | 'menu';
  onDone?: () => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations('admin');
  const [pending, setPending] = useState(false);
  const icon = action.channel === 'whatsapp' ? <WhatsAppMark className="size-4" /> : action.icon || <Mail className="size-4" aria-hidden />;

  async function open() {
    if (pending) return;
    setPending(true);
    try {
      const result = await revealContact({ userId: action.userId, reason: '' });
      if (!result.ok) {
        onError(isAdminErrorCode(result.error) ? t(`errors.${result.error}`) : t('errors.unknown'));
        return;
      }
      const email = result.data?.email?.trim();
      const phone = result.data?.phone?.trim();
      if (action.channel === 'email') {
        if (!email) {
          onError(t('noContact'));
          return;
        }
        window.location.href = `mailto:${email}`;
      } else {
        if (!phone) {
          onError(t('noContact'));
          return;
        }
        window.open(whatsappLink(phone), '_blank', 'noopener,noreferrer');
      }
      onDone?.();
    } catch {
      onError(t('errors.network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={chrome === 'menu' ? 'ghost' : 'outline'}
      size={chrome === 'icon' ? 'icon' : 'sm'}
      title={chrome === 'icon' ? action.label : undefined}
      aria-label={action.label}
      className={chrome === 'icon' ? 'size-8' : 'min-h-11 w-full justify-start px-3 font-normal'}
      disabled={pending}
      onClick={() => void open()}
    >
      {icon}
      {chrome === 'icon' ? <span className="sr-only">{action.label}</span> : action.label}
    </Button>
  );
}
