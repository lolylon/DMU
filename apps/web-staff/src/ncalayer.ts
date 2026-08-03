/**
 * NCALayer WebSocket bridge (ТЗ 9.3).
 * Requires NCALayer running locally: wss://127.0.0.1:13579/
 */
const NCALAYER_URL = 'wss://127.0.0.1:13579/';

type NcaResponse = {
  code?: string | number;
  message?: string;
  responseObject?: string;
  result?: string;
};

function parseCms(raw: NcaResponse): string {
  const cms = raw.responseObject ?? raw.result;
  if (!cms || typeof cms !== 'string') {
    throw new Error(raw.message || 'NCALayer returned empty CMS');
  }
  if (String(raw.code) === '500' || String(raw.code) === 'false') {
    throw new Error(raw.message || 'NCALayer error');
  }
  return cms;
}

export async function createCmsSignatureFromBase64(contentBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(NCALAYER_URL);
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error('NCALayer timeout — is NCALayer running?'));
      }
    }, 120_000);

    const finish = (err?: Error, cms?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(cms!);
    };

    ws.onerror = () => finish(new Error('Cannot connect to NCALayer (wss://127.0.0.1:13579/)'));
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          module: 'kz.gov.pki.knca.commonUtils',
          method: 'createCMSSignatureFromBase64',
          args: ['PKCS12', contentBase64, 'SIGNATURE', true],
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as NcaResponse;
        finish(undefined, parseCms(data));
      } catch (e) {
        finish(e instanceof Error ? e : new Error('Bad NCALayer response'));
      }
    };
  });
}
