import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { getTextModel, getVisionModel, type TextOrVisionModel } from '../../config/model-pricing.js';
import type { TenantContext } from '../tenantContext.js';

export interface ResolvedModel {
  meta: TextOrVisionModel;
  // any so we don't fight AI SDK type unions across providers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sdkModel: any;
}

export function resolveTextModel(tenant: TenantContext): ResolvedModel {
  const meta = getTextModel(tenant.textModelId);
  if (!meta) throw new Error(`Unknown text model: ${tenant.textModelId}`);
  return { meta, sdkModel: instantiate(meta, tenant) };
}

export function resolveVisionModel(tenant: TenantContext): ResolvedModel {
  const meta = getVisionModel(tenant.visionModelId);
  if (!meta) throw new Error(`Unknown vision model: ${tenant.visionModelId}`);
  return { meta, sdkModel: instantiate(meta, tenant) };
}

function instantiate(meta: TextOrVisionModel, tenant: TenantContext) {
  switch (meta.provider) {
    case 'openai': {
      if (!tenant.apiKeys.openai) throw new Error('OpenAI key not configured for tenant');
      return createOpenAI({ apiKey: tenant.apiKeys.openai })(meta.modelId);
    }
    case 'google': {
      if (!tenant.apiKeys.gemini) throw new Error('Gemini key not configured for tenant');
      return createGoogleGenerativeAI({ apiKey: tenant.apiKeys.gemini })(meta.modelId);
    }
    case 'xai': {
      if (!tenant.apiKeys.xai) throw new Error('xAI key not configured for tenant');
      return createXai({ apiKey: tenant.apiKeys.xai })(meta.modelId);
    }
  }
}
