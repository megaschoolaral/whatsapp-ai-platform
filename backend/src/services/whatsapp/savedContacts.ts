import type { Contact } from 'baileys';
import { prisma } from '../../prisma.js';

/**
 * Store contacts the tenant saved in their phone. Baileys' `name` is the address-book name;
 * `notify` is the contact's own push name, so contacts without `name` are not saved ones.
 * A contact can be known by its @lid, its phone JID, or both — store every identifier.
 */
export async function upsertSavedContacts(tenantId: string, contacts: Partial<Contact>[]): Promise<void> {
  const rows = new Map<string, string>();
  for (const c of contacts) {
    const name = c.name?.trim();
    if (!name) continue;
    for (const jid of [c.id, c.lid, c.phoneNumber]) {
      if (jid && !jid.endsWith('@g.us') && !jid.endsWith('@broadcast')) rows.set(jid, name);
    }
  }
  await Promise.all(
    Array.from(rows, ([jid, name]) =>
      prisma.savedContact.upsert({
        where: { tenantId_jid: { tenantId, jid } },
        create: { tenantId, jid, name },
        update: { name },
      }),
    ),
  );
}

export async function isSavedContact(tenantId: string, jids: Array<string | null | undefined>): Promise<boolean> {
  const list = jids.filter((j): j is string => !!j);
  if (!list.length) return false;
  const hit = await prisma.savedContact.findFirst({
    where: { tenantId, jid: { in: list } },
    select: { jid: true },
  });
  return !!hit;
}
