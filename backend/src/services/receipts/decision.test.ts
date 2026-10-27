import { describe, expect, it } from 'vitest';
import { buildClientReply, buildTelegramText, decideOutcome, phoneFromJid } from './decision.js';

describe('decideOutcome', () => {
  it('is ok when the amount reaches the minimum', () => {
    expect(decideOutcome(10000, 10000)).toEqual({ kind: 'ok' });
  });
  it('is underpaid with the missing amount when below the minimum', () => {
    expect(decideOutcome(7000, 10000)).toEqual({ kind: 'underpaid', missing: 3000 });
  });
  it('is ok when no minimum is configured', () => {
    expect(decideOutcome(5000, null)).toEqual({ kind: 'ok' });
  });
});

describe('buildClientReply', () => {
  it('confirms and promises contact when ok', () => {
    const text = buildClientReply({ kind: 'ok' });
    expect(text).toContain('Чек қабылданды');
    expect(text).toContain('жақын арада');
    expect(text).toContain('Чек принят');
  });
  it('asks for the missing amount and still promises contact when underpaid', () => {
    const text = buildClientReply({ kind: 'underpaid', missing: 3000 });
    expect(text).toMatch(/3[\s ]000/);
    expect(text).toMatch(/жақын арада/i);
  });
});

describe('buildTelegramText', () => {
  const base = { clientName: 'Айбек', phone: '77071110354', amount: 10000, iinMismatch: false };
  it('reports name, phone and amount', () => {
    const text = buildTelegramText(base);
    expect(text).toContain('Айбек');
    expect(text).toContain('77071110354');
    expect(text).toMatch(/10[\s ]000 ₸ төледі/);
    expect(text).not.toContain('ИИН сәйкес емес');
  });
  it('flags an IIN mismatch', () => {
    expect(buildTelegramText({ ...base, iinMismatch: true })).toContain('ИИН сәйкес емес');
  });
  it('says the number is unknown when the phone is missing', () => {
    expect(buildTelegramText({ ...base, phone: null })).toContain('нөмір белгісіз');
  });
  it('falls back when the client name is missing', () => {
    expect(buildTelegramText({ ...base, clientName: null })).toContain('Аты белгісіз');
  });
});

describe('phoneFromJid', () => {
  it('extracts the number from a phone jid', () => {
    expect(phoneFromJid('77071110354@s.whatsapp.net')).toBe('77071110354');
  });
  it('is null for a lid jid without an alternative', () => {
    expect(phoneFromJid('88858746167368@lid')).toBeNull();
  });
  it('uses the alternative phone jid for a lid', () => {
    expect(phoneFromJid('88858746167368@lid', '77475541501@s.whatsapp.net')).toBe('77475541501');
  });
});
