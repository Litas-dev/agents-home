export interface ModelPricing {
  inputPer1M?: number;
  outputPer1M?: number;
  perImage?: number;
  perSong?: number;
  perSecond?: number;
}

export const DEEPSEEK_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-pro': { inputPer1M: 1.74, outputPer1M: 3.48 },
  'deepseek-v4-flash': { inputPer1M: 0.14, outputPer1M: 0.28 },

  'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
  'deepseek-reasoner': { inputPer1M: 0.14, outputPer1M: 0.28 },
};

export const DEFAULT_PRICING: ModelPricing = { inputPer1M: 0, outputPer1M: 0 };

export function calculateCost(promptTokens: number, completionTokens: number, modelName: string, durationOrCount?: number): number {
  const lowerName = modelName.toLowerCase();
  const pricingKey = Object.keys(DEEPSEEK_PRICING).find(key => lowerName.includes(key));
  const pricing = pricingKey ? DEEPSEEK_PRICING[pricingKey] : DEFAULT_PRICING;

  // 1. Per Image
  if (pricing.perImage !== undefined) {
    return (durationOrCount || 1) * pricing.perImage;
  }
  
  // 2. Per Song
  if (pricing.perSong !== undefined) {
    return (durationOrCount || 1) * pricing.perSong;
  }
  
  // 3. Per Second (Video)
  if (pricing.perSecond !== undefined) {
    return (durationOrCount || 4) * pricing.perSecond; // Default 4s if not specified
  }

  // 4. Token based (Text)
  const inputCost = (promptTokens / 1000000) * (pricing.inputPer1M || 0);
  const outputCost = (completionTokens / 1000000) * (pricing.outputPer1M || 0);

  return inputCost + outputCost;
}

export function calculateTokensForCost(modelName: string, durationOrCount?: number): number {
  const lowerName = modelName.toLowerCase();
  const pricingKey = Object.keys(DEEPSEEK_PRICING).find(key => lowerName.includes(key));
  const pricing = pricingKey ? DEEPSEEK_PRICING[pricingKey] : DEFAULT_PRICING;
  
  const cost = calculateCost(0, 0, modelName, durationOrCount);
  const baseOutputPrice = (pricing.outputPer1M || DEFAULT_PRICING.outputPer1M || 0);
  if (baseOutputPrice <= 0) return 0;
  return Math.floor((cost / baseOutputPrice) * 1000000);
}
