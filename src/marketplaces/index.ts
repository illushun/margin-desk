import type { MarketplaceConfig } from '../types';
import ebay from './ebay';
import amazon from './amazon';
import bandq from './bandq';

// Adding a new marketplace: create a config file and add it here.
export const marketplaces: Record<string, MarketplaceConfig> = {
  [ebay.id]: ebay,
  [amazon.id]: amazon,
  [bandq.id]: bandq,
};

export function getMarketplace(id: string): MarketplaceConfig | undefined {
  return marketplaces[id];
}

export function listMarketplaces(): MarketplaceConfig[] {
  return Object.values(marketplaces);
}
