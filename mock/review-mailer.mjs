import nodemailer from "nodemailer";

export function smtpConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM);
}

export async function deliverReviewEmails(pool, env = process.env) {
  if (!smtpConfigured(env)) return 0;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD || "" } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  let count = 0;
  for (let index = 0; index < 20; index++) {
    const client = await pool.connect();
    let item;
    try {
      await client.query("BEGIN");
      await client.query("UPDATE note_review_notifications SET email_status='failed',email_next_attempt_at=now() WHERE email_status='sending' AND email_claimed_at < now()-interval '10 minutes'");
      item = (await client.query("SELECT n.id,n.email_to,p.title FROM note_review_notifications n JOIN notes p ON p.id=n.note_id JOIN users u ON u.id=n.user_id WHERE n.email_status IN ('pending','failed') AND n.email_next_attempt_at <= now() AND n.email_to IS NOT NULL AND u.status='active' AND u.review_email_enabled=true AND u.review_email=n.email_to AND EXISTS (SELECT 1 FROM note_review_progress r WHERE r.user_id=n.user_id AND r.note_id=n.note_id AND r.generation=n.generation) ORDER BY n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED")).rows[0];
      if (item) await client.query("UPDATE note_review_notifications SET email_status='sending',email_claimed_at=now(),email_attempts=email_attempts+1 WHERE id=$1", [item.id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    if (!item) break;
    try {
      await transport.sendMail({ from: env.SMTP_FROM, to: item.email_to, subject: `笔记复习提醒：${item.title}`, text: `今天需要复习笔记「${item.title}」。请打开学习工作空间的复习面板完成复习。` });
      await pool.query("UPDATE note_review_notifications SET email_status='sent',email_next_attempt_at=NULL,email_error=NULL WHERE id=$1", [item.id]);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "邮件发送失败";
      await pool.query("UPDATE note_review_notifications SET email_status='failed',email_error=$2,email_next_attempt_at=now()+(LEAST(60,POWER(2,LEAST(email_attempts,6)))::integer * interval '1 minute') WHERE id=$1", [item.id, reason]);
    }
    count++;
  }
  transport.close();
  return count;
}
