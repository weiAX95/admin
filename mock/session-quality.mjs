const rejectionPattern = /我无法|我不能|对不起.*无法/u;

export function detectSessionQuality(messages) {
  const flags = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (rejectionPattern.test(message.content)) flags.push({ messageId: message.id, type: 'rejection' });
    if (message.usage?.completionTokens > 2000) flags.push({ messageId: message.id, type: 'excessive_length' });
  }
  return flags;
}

export async function saveSessionQuality(client, session) {
  const key = flag => JSON.stringify([flag.messageId, flag.type]);
  const current = (await client.query('SELECT message_id AS "messageId", flag_type AS type FROM session_quality_flags WHERE session_id=$1', [session.id])).rows;
  const wanted = detectSessionQuality(session.messages);
  const currentKeys = new Set(current.map(key));
  const wantedKeys = new Set(wanted.map(key));
  for (const flag of current) if (!wantedKeys.has(key(flag))) {
    await client.query('DELETE FROM session_quality_flags WHERE session_id=$1 AND message_id=$2 AND flag_type=$3', [session.id, flag.messageId, flag.type]);
  }
  for (const flag of wanted) if (!currentKeys.has(key(flag))) {
    await client.query('INSERT INTO session_quality_flags(session_id,message_id,flag_type) VALUES($1,$2,$3)', [session.id, flag.messageId, flag.type]);
  }
}
