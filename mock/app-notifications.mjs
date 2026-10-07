import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { smtpConfigured } from './review-mailer.mjs';

export async function notifyUser(client, userId, kind, entityId, title, body, targetUrl) {
  if (!userId) return false;
  const user = (await client.query("SELECT id,review_email,review_email_enabled FROM users WHERE id=$1 AND status='active'", [userId])).rows[0];
  if (!user) return false;
  const email = user.review_email_enabled && user.review_email ? user.review_email : null;
  const result = await client.query('INSERT INTO app_notifications(id,user_id,kind,entity_id,title,body,target_url,email_to,email_status,email_next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,kind,entity_id) DO NOTHING', [crypto.randomUUID(),userId,kind,entityId,title,body,targetUrl,email,email?'pending':'skipped',email?new Date():null]);
  return result.rowCount > 0;
}

export async function deliverAppEmails(pool, env=process.env) {
  if (!smtpConfigured(env)) return 0;
  const transport=nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT),secure:Number(env.SMTP_PORT)===465,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASSWORD||''}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
  let count=0;
  for(let index=0;index<20;index++){
    const client=await pool.connect();let item;
    try{
      await client.query('BEGIN');
      await client.query("UPDATE app_notifications SET email_status='failed',email_next_attempt_at=now() WHERE email_status='sending' AND email_claimed_at < now()-interval '10 minutes'");
      item=(await client.query("SELECT n.id,n.email_to,n.title,n.body FROM app_notifications n JOIN users u ON u.id=n.user_id WHERE n.email_status IN ('pending','failed') AND n.email_next_attempt_at<=now() AND n.email_to IS NOT NULL AND u.status='active' AND u.review_email_enabled=true AND u.review_email=n.email_to ORDER BY n.created_at LIMIT 1 FOR UPDATE OF n SKIP LOCKED")).rows[0];
      if(item)await client.query("UPDATE app_notifications SET email_status='sending',email_claimed_at=now(),email_attempts=email_attempts+1 WHERE id=$1",[item.id]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    if(!item)break;
    try{await transport.sendMail({from:env.SMTP_FROM,to:item.email_to,subject:item.title,text:item.body});await pool.query("UPDATE app_notifications SET email_status='sent',email_next_attempt_at=NULL,email_error=NULL WHERE id=$1",[item.id]);}
    catch(error){await pool.query("UPDATE app_notifications SET email_status='failed',email_error=$2,email_next_attempt_at=now()+(LEAST(60,POWER(2,LEAST(email_attempts,6)))::integer * interval '1 minute') WHERE id=$1",[item.id,String(error.message||error).slice(0,500)]);}
    count++;
  }
  transport.close();return count;
}
