// PRICING UPDATE WORKFLOW:
// To update prices, ask Claude Code:
// "Search the web for current API pricing for GPT-5.1, Gemini 3 Flash,
//  Grok 4.1 Fast, ElevenLabs Scribe v2, and Soniox. Update model-pricing.ts
//  with latest values and update lastUpdated date."

export type ProviderId = 'openai' | 'google' | 'xai' | 'elevenlabs' | 'soniox';

export interface TextOrVisionModel {
  provider: Extract<ProviderId, 'openai' | 'google' | 'xai'>;
  modelId: string;
  displayName: string;
  inputPer1M: number;
  outputPer1M: number;
  avgCostPerMessage: number;
  contextWindow: number;
  supportsVision: boolean;
  isActive: boolean;
  notes: string;
}

export interface SttModel {
  provider: Extract<ProviderId, 'elevenlabs' | 'soniox'>;
  modelId: string;
  displayName: string;
  pricePerHour: number;
  isActive: boolean;
  notes: string;
}

export const MODEL_PRICING = {
  text: {
    'gpt-5.1': {
      provider: 'openai',
      modelId: 'gpt-5.1',
      displayName: 'GPT-5.1',
      inputPer1M: 1.25,
      outputPer1M: 10.0,
      avgCostPerMessage: 0.005,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'Universal, надёжный, vision встроен',
    },
    'gemini-3-flash': {
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      displayName: 'Gemini 3 Flash',
      inputPer1M: 0.5,
      outputPer1M: 3.0,
      avgCostPerMessage: 0.002,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'Быстрый и дешёвый, vision встроен',
    },
    'grok-4.1-fast': {
      provider: 'xai',
      modelId: 'grok-4-fast',
      displayName: 'Grok 4.1 Fast',
      inputPer1M: 0.2,
      outputPer1M: 0.5,
      avgCostPerMessage: 0.0007,
      contextWindow: 2_000_000,
      supportsVision: false,
      isActive: true,
      notes: 'Самый дешёвый, 2M context. Vision слабый — для фото использовать Vision Model.',
    },
  } satisfies Record<string, TextOrVisionModel>,

  vision: {
    'gpt-5.1': {
      provider: 'openai',
      modelId: 'gpt-5.1',
      displayName: 'GPT-5.1',
      inputPer1M: 1.25,
      outputPer1M: 10.0,
      avgCostPerMessage: 0.005,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'OpenAI vision',
    },
    'gemini-3-flash': {
      provider: 'google',
      modelId: 'gemini-2.5-flash',
      displayName: 'Gemini 3 Flash',
      inputPer1M: 0.5,
      outputPer1M: 3.0,
      avgCostPerMessage: 0.002,
      contextWindow: 1_000_000,
      supportsVision: true,
      isActive: true,
      notes: 'Google vision',
    },
  } satisfies Record<string, TextOrVisionModel>,

  stt: {
    'elevenlabs-scribe-v2': {
      provider: 'elevenlabs',
      modelId: 'scribe_v2',
      displayName: 'ElevenLabs Scribe v2',
      pricePerHour: 0.4,
      isActive: true,
      notes: '90+ языков, отлично для русского',
    },
    soniox: {
      provider: 'soniox',
      modelId: 'stt-async-preview',
      displayName: 'Soniox',
      pricePerHour: 0.4,
      isActive: true,
      notes: 'Лучшее качество для казахского языка',
    },
  } satisfies Record<string, SttModel>,

  lastUpdated: '2026-05-08',
} as const;

export type TextModelId = keyof typeof MODEL_PRICING.text;
export type VisionModelId = keyof typeof MODEL_PRICING.vision;
export type SttModelId = keyof typeof MODEL_PRICING.stt;

export function getTextModel(id: string): TextOrVisionModel | null {
  return (MODEL_PRICING.text as Record<string, TextOrVisionModel>)[id] ?? null;
}
export function getVisionModel(id: string): TextOrVisionModel | null {
  return (MODEL_PRICING.vision as Record<string, TextOrVisionModel>)[id] ?? null;
}
export function getSttModel(id: string): SttModel | null {
  return (MODEL_PRICING.stt as Record<string, SttModel>)[id] ?? null;
}

export function calcTextCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const m = getTextModel(modelId) ?? getVisionModel(modelId);
  if (!m) return 0;
  return (inputTokens * m.inputPer1M) / 1_000_000 + (outputTokens * m.outputPer1M) / 1_000_000;
}

export function calcSttCost(modelId: string, durationSeconds: number): number {
  const m = getSttModel(modelId);
  if (!m) return 0;
  return (durationSeconds / 3600) * m.pricePerHour;
}
