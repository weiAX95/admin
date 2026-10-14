import net from 'node:net';
import { Reader } from '@maxmind/geoip2-node';

let readerPromise;

export async function loginLocation(ip, env = process.env) {
  if (!env.GEOIP_DATABASE_PATH || !net.isIP(ip)) return null;
  readerPromise ||= Reader.open(env.GEOIP_DATABASE_PATH, { watchForUpdates: true }).catch(error => {
    console.error('[geoip] 本地数据库不可用：', error.message);
    return null;
  });
  const reader = await readerPromise;
  if (!reader) return null;
  try {
    const result = reader.city(ip);
    const country = result.country?.isoCode || null;
    if (!country) return null;
    return { country, subdivision: result.subdivisions?.[0]?.isoCode || null };
  } catch { return null; }
}

export function differentLoginRegion(previous, current) {
  if (!previous?.geo_country || !current?.country) return false;
  if (previous.geo_country !== current.country) return true;
  return Boolean(previous.geo_subdivision && current.subdivision && previous.geo_subdivision !== current.subdivision);
}
