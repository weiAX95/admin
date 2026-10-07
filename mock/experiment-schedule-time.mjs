const formatterCache = new Map();
function formatter(zone) {
  if (!formatterCache.has(zone)) formatterCache.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return formatterCache.get(zone);
}
export function validTimeZone(zone) { try { formatter(zone).format(new Date()); return true; } catch { return false; } }
function parts(timestamp, zone) { return Object.fromEntries(formatter(zone).formatToParts(timestamp).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])); }
function localInstant(year, month, day, hour, minute, zone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let next = null;
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const candidate = guess + offset * 60_000;
    const value = parts(candidate, zone);
    if (value.year !== year || value.month !== month || value.day !== day) continue;
    const clock = value.hour * 60 + value.minute;
    if (clock === hour * 60 + minute) return candidate;
    if (clock > hour * 60 + minute && (next === null || candidate < next)) next = candidate;
  }
  // Spring-forward gaps use the first real minute after the requested wall time.
  return next;
}
export function nextScheduleAt({ frequency, localTime, timeZone, weekday, dayOfMonth }, after = Date.now()) {
  if (!validTimeZone(timeZone)) throw new Error('无效的 IANA 时区');
  if (!['daily','weekly','monthly'].includes(frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error('调度频率或时间无效');
  const local = parts(after, timeZone);
  const [hour, minute] = localTime.split(':').map(Number);
  const start = Date.UTC(local.year, local.month - 1, local.day);
  for (let i = 0; i < 370; i++) {
    const day = new Date(start + i * 86_400_000);
    const year = day.getUTCFullYear(), month = day.getUTCMonth() + 1, date = day.getUTCDate();
    if (frequency === 'weekly' && day.getUTCDay() !== weekday) continue;
    if (frequency === 'monthly' && date !== Math.min(dayOfMonth, new Date(Date.UTC(year, month, 0)).getUTCDate())) continue;
    const result = localInstant(year, month, date, hour, minute, timeZone);
    if (result !== null && result > after) return new Date(result).toISOString();
  }
  throw new Error('无法计算下一次调度时间');
}
