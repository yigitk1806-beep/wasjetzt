'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import type { Plan } from '@/types/domain';

type Props = {
  plan: Plan;
  open: boolean;
  onClose: () => void;
};

/** Teilen ohne Hürde: ein Link, den jeder ohne Anmeldung öffnen kann. */
export function ShareSheet({ plan, open, onClose }: Props) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [canUseNative, setCanUseNative] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setUrl(`${window.location.origin}/plan/${plan.id}`);
    setCanUseNative(typeof navigator.share === 'function');
  }, [plan.id]);

  const message = `${plan.title}: ${plan.steps.map((s) => `${s.place.emoji} ${s.place.kind}`).join(' → ')}`;
  const encoded = encodeURIComponent(`${message}\n${url}`);

  const channels = [
    { label: 'WhatsApp', emoji: '💬', href: `https://wa.me/?text=${encoded}` },
    {
      label: 'Telegram',
      emoji: '✈️',
      href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,
    },
    { label: 'SMS', emoji: '📱', href: `sms:?&body=${encoded}` },
    {
      label: 'E-Mail',
      emoji: '✉️',
      href: `mailto:?subject=${encodeURIComponent(plan.title)}&body=${encoded}`,
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Plan teilen">
      <p className="mb-4 text-[0.88rem] text-ink-muted">
        Wer den Link öffnet, sieht den Plan sofort – ganz ohne Anmeldung.
      </p>

      {canUseNative ? (
        <Button
          full
          size="lg"
          className="mb-3"
          onClick={() => {
            void navigator.share({ title: plan.title, text: message, url });
          }}
          icon={<span aria-hidden>↗</span>}
        >
          Teilen
        </Button>
      ) : null}

      <div className="grid grid-cols-4 gap-2">
        {channels.map((channel) => (
          <a
            key={channel.label}
            href={channel.href}
            target="_blank"
            rel="noopener noreferrer"
            className="tap flex flex-col items-center gap-1.5 rounded-2xl bg-canvas-sunk py-3.5 text-[0.74rem] font-medium text-ink-soft"
          >
            <span className="text-xl" aria-hidden>
              {channel.emoji}
            </span>
            {channel.label}
          </a>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void copy()}
        className="tap mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-canvas-sunk px-4 py-3.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[0.82rem] text-ink-muted">{url}</span>
        <span className="shrink-0 text-[0.82rem] font-semibold text-brand-600">
          {copied ? 'Kopiert' : 'Kopieren'}
        </span>
      </button>

      {plan.expiresAtISO ? (
        <p className="mt-4 text-[0.76rem] leading-relaxed text-ink-faint">
          Der Link funktioniert bis{' '}
          {new Date(plan.expiresAtISO).toLocaleString('de', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          Uhr.
        </p>
      ) : null}
    </Sheet>
  );
}
