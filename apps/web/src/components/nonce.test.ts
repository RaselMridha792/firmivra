import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NonceProvider, useNonce } from './nonce';

// The root layout hands the request's CSP nonce to client components through this context.
function Probe() {
  return createElement('script', { nonce: useNonce(), suppressHydrationWarning: true });
}

const render = (nonce: string | undefined) =>
  renderToString(createElement(NonceProvider, { nonce }, createElement(Probe)));

describe('NonceProvider', () => {
  it("gives a client component the request's nonce for its inline script", () => {
    expect(render('synthetic-nonce')).toContain('nonce="synthetic-nonce"');
  });

  it('leaves the nonce off where the request has none', () => {
    expect(render(undefined)).not.toContain('nonce=');
  });
});
