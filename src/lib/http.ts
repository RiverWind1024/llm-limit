export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_ERROR_BODY = 300;

async function readErrorBody(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}…` : text;
  } catch {
    return "";
  }
}

export async function getJSON<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const resp = await fetch(url, { ...init, signal });
  if (!resp.ok) {
    const body = await readErrorBody(resp);
    throw new HttpError(`HTTP ${resp.status}${body ? `: ${body}` : ""}`, resp.status);
  }
  return (await resp.json()) as T;
}

export async function getText(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(url, { ...init, signal });
  if (!resp.ok) {
    const body = await readErrorBody(resp);
    throw new HttpError(`HTTP ${resp.status}${body ? `: ${body}` : ""}`, resp.status);
  }
  return await resp.text();
}

export function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

/** 把任意异常转成可展示的一行文本。 */
export function describeError(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError") return "请求已取消";
    return err.message;
  }
  return String(err);
}
