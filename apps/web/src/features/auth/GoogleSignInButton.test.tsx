import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BackendProvider } from '../../adapters/BackendContext';
import { createBackend } from '../../adapters/factory';
import type { Backend } from '../../adapters/ports';
import { GoogleSignInButton } from './GoogleSignInButton';
import type { GsiIdApi } from './googleIdentity';

// The real adapters are irrelevant here — the component only reads `mode`.
function backendWithMode(mode: Backend['mode']): Backend {
  return { ...createBackend(), mode };
}

interface GsiStub {
  initializeCfg?: Parameters<GsiIdApi['initialize']>[0];
  renderOpts?: Parameters<GsiIdApi['renderButton']>[1];
}

/** Installs a fake `window.google.accounts.id` (as if the GIS script already
 * loaded) and returns a handle to what the component passed into it. */
function stubGis(): GsiStub {
  const stub: GsiStub = {};
  (window as unknown as { google?: unknown }).google = {
    accounts: {
      id: {
        initialize: (cfg: Parameters<GsiIdApi['initialize']>[0]) => {
          stub.initializeCfg = cfg;
        },
        renderButton: (parent: HTMLElement, opts: Parameters<GsiIdApi['renderButton']>[1]) => {
          stub.renderOpts = opts;
          const fake = document.createElement('div');
          fake.textContent = 'GIS 버튼';
          parent.appendChild(fake);
        },
      } satisfies GsiIdApi,
    },
  };
  return stub;
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { google?: unknown }).google;
});

const FALLBACK = <button type="button">기존 Google 버튼</button>;

describe('GoogleSignInButton', () => {
  it('renders only the fallback in local/demo mode (GIS never touched)', () => {
    const stub = stubGis();
    render(
      <BackendProvider backend={backendWithMode('local')}>
        <GoogleSignInButton onCredential={vi.fn()} fallback={FALLBACK} clientId="cid.apps.googleusercontent.com" />
      </BackendProvider>,
    );
    expect(screen.getByRole('button', { name: '기존 Google 버튼' })).toBeTruthy();
    expect(stub.initializeCfg).toBeUndefined();
  });

  it('renders only the fallback when no client ID is configured', () => {
    const stub = stubGis();
    render(
      <BackendProvider backend={backendWithMode('supabase')}>
        <GoogleSignInButton onCredential={vi.fn()} fallback={FALLBACK} clientId={null} />
      </BackendProvider>,
    );
    expect(screen.getByRole('button', { name: '기존 Google 버튼' })).toBeTruthy();
    expect(stub.initializeCfg).toBeUndefined();
  });

  it('initializes GIS with the client ID + hashed nonce, renders the button, and swaps out the fallback', async () => {
    const stub = stubGis();
    render(
      <BackendProvider backend={backendWithMode('supabase')}>
        <GoogleSignInButton onCredential={vi.fn()} fallback={FALLBACK} clientId="cid.apps.googleusercontent.com" />
      </BackendProvider>,
    );
    await waitFor(() => expect(stub.initializeCfg).toBeTruthy());
    expect(stub.initializeCfg!.client_id).toBe('cid.apps.googleusercontent.com');
    expect(stub.initializeCfg!.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(stub.renderOpts).toMatchObject({ text: 'continue_with', locale: 'ko', size: 'large' });
    expect(screen.getByText('GIS 버튼')).toBeTruthy();
    // Once GIS actually rendered, the redirect-flow fallback disappears.
    await waitFor(() => expect(screen.queryByRole('button', { name: '기존 Google 버튼' })).toBeNull());
  });

  it('delivers the credential with the RAW nonce whose sha256 was given to GIS', async () => {
    const stub = stubGis();
    const onCredential = vi.fn();
    render(
      <BackendProvider backend={backendWithMode('supabase')}>
        <GoogleSignInButton onCredential={onCredential} fallback={FALLBACK} clientId="cid.apps.googleusercontent.com" />
      </BackendProvider>,
    );
    await waitFor(() => expect(stub.initializeCfg).toBeTruthy());

    stub.initializeCfg!.callback({ credential: 'google-jwt' });
    expect(onCredential).toHaveBeenCalledTimes(1);
    const [token, rawNonce] = onCredential.mock.calls[0] as [string, string];
    expect(token).toBe('google-jwt');
    expect(createHash('sha256').update(rawNonce).digest('hex')).toBe(stub.initializeCfg!.nonce);
  });

  it('ignores GIS responses that carry no credential (dismissed popup)', async () => {
    const stub = stubGis();
    const onCredential = vi.fn();
    render(
      <BackendProvider backend={backendWithMode('supabase')}>
        <GoogleSignInButton onCredential={onCredential} fallback={FALLBACK} clientId="cid.apps.googleusercontent.com" />
      </BackendProvider>,
    );
    await waitFor(() => expect(stub.initializeCfg).toBeTruthy());
    stub.initializeCfg!.callback({});
    expect(onCredential).not.toHaveBeenCalled();
  });
});
