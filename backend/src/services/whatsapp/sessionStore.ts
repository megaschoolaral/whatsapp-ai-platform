import {
  initAuthCreds,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  BufferJSON,
  proto,
} from 'baileys';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { encrypt, decrypt } from '../../crypto/aesGcm.js';

type KeyStore = Record<string, Record<string, unknown>>;

const KEYS_FLUSH_MS = 30_000;
const flushers = new Map<string, () => Promise<void>>();

/** Persist any pending (debounced) auth keys for one tenant. */
export async function flushAuthKeys(tenantId: string): Promise<void> {
  await flushers.get(tenantId)?.();
}

/** Persist pending auth keys for every tenant (call on shutdown). */
export async function flushAllAuthKeys(): Promise<void> {
  await Promise.allSettled(Array.from(flushers.values()).map((f) => f()));
}

function reviveCreds(raw: string): AuthenticationCreds {
  return JSON.parse(raw, BufferJSON.reviver) as AuthenticationCreds;
}
function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

/**
 * Custom Baileys auth state backed by Postgres with encrypted creds/keys.
 * Keys map structure follows the Baileys `useMultiFileAuthState` reference impl.
 */
export async function makeDbAuthState(tenantId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // Unsaved keys from a previous socket must hit the DB before we read it back.
  await flushAuthKeys(tenantId).catch(() => undefined);

  const session = await prisma.whatsappSession.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });

  let creds: AuthenticationCreds;
  let keysData: KeyStore = {};

  if (session.encryptedCreds) {
    try {
      creds = reviveCreds(decrypt(session.encryptedCreds));
    } catch {
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }
  if (session.encryptedKeys) {
    try {
      keysData = JSON.parse(decrypt(session.encryptedKeys), BufferJSON.reviver) as KeyStore;
    } catch {
      keysData = {};
    }
  }

  // The keys blob is several MB and every UPDATE rewrites it whole (plus dead TOAST copies),
  // while Baileys calls keys.set hundreds of times on connect. Coalesce writes: mark dirty and
  // persist at most once per KEYS_FLUSH_MS, and flush explicitly on close/shutdown.
  let dirty = false;
  let timer: NodeJS.Timeout | null = null;
  const flushKeys = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      await prisma.whatsappSession.update({
        where: { tenantId },
        data: { encryptedKeys: encrypt(serialize(keysData)) },
      });
    } catch (err) {
      dirty = true;
      throw err;
    }
  };
  const saveKeys = async () => {
    dirty = true;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        flushKeys().catch((err) => logger.error({ err, tenantId }, '[whatsapp] failed to persist auth keys'));
      }, KEYS_FLUSH_MS);
    }
  };

  flushers.set(tenantId, flushKeys);

  const saveCreds = async () => {
    await prisma.whatsappSession.update({
      where: { tenantId },
      data: { encryptedCreds: encrypt(serialize(creds)) },
    });
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const out: Record<string, SignalDataTypeMap[T]> = {};
        const bucket = keysData[type] ?? {};
        for (const id of ids) {
          let value = bucket[id] as SignalDataTypeMap[T] | undefined;
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as object,
            ) as unknown as SignalDataTypeMap[T];
          }
          if (value) out[id] = value;
        }
        return out;
      },
      set: async (data) => {
        for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          if (!keysData[category]) keysData[category] = {};
          const bucket = keysData[category]!;
          const sub = data[category]!;
          for (const id of Object.keys(sub)) {
            const v = sub[id];
            if (v === null || v === undefined) {
              delete bucket[id];
            } else {
              bucket[id] = v as unknown as Record<string, unknown>;
            }
          }
        }
        await saveKeys();
      },
    },
  };

  return { state, saveCreds };
}
