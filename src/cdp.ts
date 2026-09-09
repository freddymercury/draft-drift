/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Playwright would work too, but this is a few dozen lines over a WebSocket
 * Bun already ships — nothing to install, nothing to break on hotel wifi.
 */

export interface Target {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export const PORT = 9222;

export async function listTargets(port = PORT): Promise<Target[]> {
  const res = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`CDP HTTP ${res.status}`);
  return (await res.json()) as Target[];
}

/** The Yahoo draft tab, if it's open. */
export async function findDraftTab(port = PORT): Promise<Target | null> {
  const targets = await listTargets(port);
  const pages = targets.filter((t) => t.type === "page");
  return (
    pages.find((t) => /draftclient/i.test(t.url)) ??
    pages.find((t) => /fantasysports\.yahoo\.com/i.test(t.url)) ??
    null
  );
}

/** Evaluate an expression in a page and return its value. */
export function evaluate<T>(wsUrl: string, expression: string, timeoutMs = 8000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("CDP evaluate timed out"));
    }, timeoutMs);

    const done = (fn: () => void) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      fn();
    };

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        if (msg.error) return done(() => reject(new Error(msg.error.message)));
        const ex = msg.result?.exceptionDetails;
        if (ex) return done(() => reject(new Error(ex.text ?? "page exception")));
        done(() => resolve(msg.result?.result?.value as T));
      } catch (e) {
        done(() => reject(e as Error));
      }
    };
    ws.onerror = () => done(() => reject(new Error(`cannot connect to ${wsUrl}`)));
  });
}

export interface PageSnapshot {
  title: string;
  url: string;
  text: string;
  capturedAt: string;
}

/** Read the live page — same shape as an AgentEyes capture, but always current. */
export async function snapshot(port = PORT): Promise<PageSnapshot> {
  const tab = await findDraftTab(port);
  if (!tab) throw new Error("no Yahoo draft tab found — is the draft page open in the debug window?");
  const data = await evaluate<{ title: string; url: string; text: string }>(
    tab.webSocketDebuggerUrl,
    `({ title: document.title, url: location.href, text: document.body.innerText })`,
  );
  return { ...data, capturedAt: new Date().toISOString() };
}
