import { z } from 'zod';

import { HttpUtil } from '@/utils';
import { parseMsg } from '@/utils/zodValidate';
import {
  ClientViewSchema,
  MeViewSchema,
  ResellerViewSchema,
  SessionViewSchema,
  type ClientView,
  type MeView,
  type ResellerView,
  type SessionView,
} from '@/generated/zod';

export type { ClientView, MeView, ResellerView, SessionView };

export const LedgerRowSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  delta: z.number().int(),
  balanceAfter: z.number().int(),
  reason: z.string(),
  clientEmail: z.string(),
  days: z.number().int(),
  actorId: z.number().int(),
  createdAt: z.number().int(),
});
export type LedgerRow = z.infer<typeof LedgerRowSchema>;

export const AuditRowSchema = z.object({
  id: z.number().int(),
  actorId: z.number().int(),
  action: z.string(),
  target: z.string(),
  detail: z.string(),
  ip: z.string(),
  createdAt: z.number().int(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

export const ClientLinksSchema = z.object({
  subscription: z
    .array(z.string())
    .nullable()
    .transform((v) => v ?? []),
  links: z
    .array(z.string())
    .nullable()
    .transform((v) => v ?? []),
});
export type ClientLinks = z.infer<typeof ClientLinksSchema>;

export const ovixKeys = {
  root: () => ['ovix'] as const,
  session: () => ['ovix', 'session'] as const,
  resellers: () => ['ovix', 'resellers'] as const,
  ledger: (userId: number) => ['ovix', 'ledger', userId] as const,
  audit: () => ['ovix', 'audit'] as const,
  me: () => ['ovix', 'me'] as const,
  myClients: () => ['ovix', 'myClients'] as const,
  myLedger: () => ['ovix', 'myLedger'] as const,
} as const;

async function getList<T extends z.ZodType>(url: string, schema: T): Promise<z.infer<T>[]> {
  const msg = await HttpUtil.get(url, undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || `Failed to load ${url}`);
  const parsed = parseMsg(msg, z.array(schema).nullable(), url);
  return (parsed.obj as z.infer<T>[] | null) ?? [];
}

async function getOne<T extends z.ZodType>(url: string, schema: T): Promise<z.infer<T>> {
  const msg = await HttpUtil.get(url, undefined, { silent: true });
  if (!msg?.success) throw new Error(msg?.msg || `Failed to load ${url}`);
  return parseMsg(msg, schema, url, { strict: true }).obj as z.infer<T>;
}

// Resolves to null when the backend has no session route, so the owner panel
// still loads against an older backend.
export async function fetchSession(): Promise<SessionView | null> {
  const msg = await HttpUtil.get('/panel/api/ovix/session', undefined, { silent: true });
  if (!msg?.success) return null;
  const parsed = SessionViewSchema.safeParse(msg.obj);
  return parsed.success ? parsed.data : null;
}

export const fetchResellers = () => getList('/panel/api/ovix/resellers/list', ResellerViewSchema);
export const fetchLedger = (userId: number) =>
  getList(`/panel/api/ovix/resellers/ledger/${userId}`, LedgerRowSchema);
export const fetchAudit = () =>
  getList('/panel/api/ovix/resellers/audit?limit=200', AuditRowSchema);

export const fetchMe = () => getOne('/panel/api/reseller/me', MeViewSchema);
export const fetchMyClients = () => getList('/panel/api/reseller/clients', ClientViewSchema);
export const fetchMyLedger = () => getList('/panel/api/reseller/ledger?limit=200', LedgerRowSchema);
export const fetchMyClientLinks = (email: string) =>
  getOne(`/panel/api/reseller/clients/links/${encodeURIComponent(email)}`, ClientLinksSchema);

export interface ResellerForm {
  username?: string;
  password?: string;
  note: string;
  disabled?: boolean;
  inboundIds: number[];
}

export interface NewClientForm {
  email: string;
  days: number;
  inboundIds: number[];
  trafficLimitGB: number;
  limitIp: number;
  comment: string;
  tgId: number;
  startOnFirstUse: boolean;
}

export interface ClientEditForm {
  enable: boolean;
  trafficLimitGB: number;
  limitIp: number;
  comment: string;
  tgId: number;
}

export const ovixApi = {
  addReseller: (form: ResellerForm) => HttpUtil.post('/panel/api/ovix/resellers/add', form),
  updateReseller: (id: number, form: ResellerForm) =>
    HttpUtil.post(`/panel/api/ovix/resellers/update/${id}`, form),
  setPassword: (id: number, password: string) =>
    HttpUtil.post(`/panel/api/ovix/resellers/password/${id}`, { password }),
  addCredit: (id: number, delta: number) =>
    HttpUtil.post(`/panel/api/ovix/resellers/credit/${id}`, { delta }),
  deleteReseller: (id: number) => HttpUtil.post(`/panel/api/ovix/resellers/del/${id}`),

  addClient: (form: NewClientForm) => HttpUtil.post('/panel/api/reseller/clients/add', form),
  renewClient: (email: string, days: number) =>
    HttpUtil.post(`/panel/api/reseller/clients/renew/${encodeURIComponent(email)}`, { days }),
  updateClient: (email: string, form: ClientEditForm) =>
    HttpUtil.post(`/panel/api/reseller/clients/update/${encodeURIComponent(email)}`, form),
  resetClientTraffic: (email: string) =>
    HttpUtil.post(`/panel/api/reseller/clients/resetTraffic/${encodeURIComponent(email)}`),
  deleteClient: (email: string) =>
    HttpUtil.post(`/panel/api/reseller/clients/del/${encodeURIComponent(email)}`),
};
