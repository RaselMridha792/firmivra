'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getCountdown } from './countdown';

export function ComingSoon({
  brand,
  logo,
  description,
  launchAt,
  launchDate,
}: {
  brand: string;
  logo: ReactNode;
  description: string;
  launchAt: string;
  launchDate: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const target = Date.parse(launchAt);
    const update = () => {
      const seconds = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(seconds);
      return seconds;
    };
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(() => {
      if (update() === 0) window.clearInterval(interval);
    }, 1000);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, [launchAt]);
  const countdown = remaining === null ? null : getCountdown(remaining);
  return (
    <main className="fv-launch">
      <div className="fv-launch-content">
        <div className="fv-wordmark" aria-label={brand}>
          {logo}
        </div>
        <h1>
          Coming soon<span>.</span>
        </h1>
        <p className="fv-launch-description">{description}</p>
        <div
          className="fv-countdown"
          role="group"
          aria-label="Countdown to planned beta"
          aria-live="off"
        >
          {(['days', 'hours', 'minutes', 'seconds'] as const).map((unit) => (
            <div className="fv-countdown-unit" key={unit}>
              <span className="fv-countdown-value" data-testid={`countdown-${unit}`}>
                {countdown === null ? '––' : String(countdown[unit]).padStart(2, '0')}
              </span>
              <span className="fv-countdown-label">{unit}</span>
            </div>
          ))}
        </div>
        <p className="fv-launch-date">
          {remaining === 0 ? 'Final preparations underway' : 'Planned first beta'}
          <span aria-hidden="true"> · </span>
          <time dateTime={launchAt}>{launchDate}</time>
        </p>
      </div>
    </main>
  );
}
