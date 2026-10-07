import crypto from "node:crypto";

export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];
export const shanghaiDate = value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const addCalendarDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const reminderTime = date => Date.parse(`${date}T09:00:00+08:00`);

export async function initializeNoteReviews(client, noteId, now = new Date()) {
  const today = shanghaiDate(now);
  await client.query("INSERT INTO note_review_progress(user_id,note_id,started_on,due_on) SELECT id,$1,$2,$3 FROM users ON CONFLICT DO NOTHING", [noteId, today, addCalendarDays(today, 1)]);
}

export async function initializeUserReviews(client, userId, now = new Date()) {
  const today = shanghaiDate(now);
  await client.query("INSERT INTO note_review_progress(user_id,note_id,started_on,due_on) SELECT $1,id,$2,$3 FROM notes ON CONFLICT DO NOTHING", [userId, today, addCalendarDays(today, 1)]);
}

export async function resetNoteReviews(client, noteId, now = new Date()) {
  const today = shanghaiDate(now);
  await client.query("UPDATE note_review_notifications SET read_at=coalesce(read_at,$2) WHERE note_id=$1 AND read_at IS NULL", [noteId, now]);
  await client.query("UPDATE note_review_progress SET step=0,generation=generation+1,started_on=$2,due_on=$3,last_reviewed_at=NULL WHERE note_id=$1", [noteId, today, addCalendarDays(today, 1)]);
}

export async function completeNoteReview(client, userId, noteId, generation, now = new Date()) {
  const row = (await client.query("SELECT step,generation,to_char(due_on,'YYYY-MM-DD') AS due_on FROM note_review_progress WHERE user_id=$1 AND note_id=$2 FOR UPDATE", [userId, noteId])).rows[0];
  if (!row) return { status: "missing" };
  if (row.generation !== generation) return { status: "conflict" };
  if (shanghaiDate(now) < row.due_on) return { status: "early" };
  const step = Math.min(row.step + 1, REVIEW_INTERVALS.length - 1);
  const today = shanghaiDate(now);
  const dueOn = addCalendarDays(today, REVIEW_INTERVALS[step]);
  await client.query("INSERT INTO note_review_events(id,user_id,note_id,generation,reviewed_at) VALUES($1,$2,$3,$4,$5)", [crypto.randomUUID(), userId, noteId, generation, now]);
  await client.query("UPDATE note_review_progress SET step=$3,generation=generation+1,started_on=$4,due_on=$5,last_reviewed_at=$6 WHERE user_id=$1 AND note_id=$2", [userId, noteId, step, today, dueOn, now]);
  await client.query("UPDATE note_review_notifications SET read_at=coalesce(read_at,$4) WHERE user_id=$1 AND note_id=$2 AND generation=$3", [userId, noteId, generation, now]);
  return { status: "ok", step, generation: generation + 1, dueOn, reviewedAt: now.toISOString() };
}

export async function createDueReviewNotifications(client, now = new Date()) {
  const today = shanghaiDate(now);
  const rows = (await client.query("SELECT p.user_id,p.note_id,p.generation,to_char(p.due_on,'YYYY-MM-DD') AS due_on,u.review_email,u.review_email_enabled FROM note_review_progress p JOIN users u ON u.id=p.user_id WHERE u.status='active' AND p.due_on <= $1", [today])).rows;
  let created = 0;
  for (const row of rows) {
    if (now.getTime() < reminderTime(row.due_on)) continue;
    const email = row.review_email_enabled && row.review_email ? row.review_email : null;
    const result = await client.query("INSERT INTO note_review_notifications(id,user_id,note_id,generation,due_on,created_at,email_status,email_next_attempt_at,email_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING", [crypto.randomUUID(), row.user_id, row.note_id, row.generation, row.due_on, now, email ? "pending" : "skipped", email ? now : null, email]);
    created += result.rowCount;
  }
  return created;
}
