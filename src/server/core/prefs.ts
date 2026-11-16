// A player's own settings, remembered across devices. So far there is one:
// whether sound is off.

import { redis } from '@devvit/web/server';
import { KEYS } from './keys';

/** Whether a player has turned sound off. False until they say so. */
export const isMuted = async (userId: string): Promise<boolean> => {
  const json = await redis.hGet(KEYS.prefs, userId);
  if (json === undefined) return false;
  const value: unknown = JSON.parse(json);
  return typeof value === 'object' && value !== null && 'muted' in value && value.muted === true;
};

export const setMuted = (userId: string, muted: boolean): Promise<number> =>
  redis.hSet(KEYS.prefs, { [userId]: JSON.stringify({ muted }) });
