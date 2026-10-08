import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate } from "../mock/postgres-store.mjs";
import { basicFixture, createPgTestServer } from "./pg-helper.mjs";
import { addCalendarDays, completeNoteReview, createDueReviewNotifications, reminderTime, shanghaiDate } from "../mock/note-reviews.mjs";
import { smtpConfigured, deliverReviewEmails } from "../mock/review-mailer.mjs";
import { NOTE_TEMPLATES } from "../src/utils/noteTemplates.ts";

test("calendar intervals, Shanghai boundaries and built-in templates", () => {
  assert.equal(shanghaiDate("2026-10-06T16:00:00Z"), "2026-10-07");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(reminderTime("2026-10-07"), Date.parse("2026-10-07T01:00:00Z"));
  assert.equal(NOTE_TEMPLATES.length, 5);
  for (const item of NOTE_TEMPLATES) assert.match(item.content, /\[.+\]/);
  assert.equal(smtpConfigured({}), false);
});

test("review plans are per user, reset on content edits, and complete once per generation", async t => {
  const fixture = basicFixture();
  fixture.notes = [{ id: "old", title: "旧笔记", content: "原文", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }];
  const api = await createPgTestServer(t, fixture);
  const login = async (username, password) => (await (await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })).json()).token;
  const admin = await login("admin", "admin123");
  const member = await login("member", "test");
  const call = async (token, path, method = "GET", body) => {
    const response = await fetch(`${api.base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_progress WHERE note_id='old'")).rows[0].count, 3);
  assert.equal((await call(admin, "/account/review-settings", "PUT", { email: "bad", emailEnabled: true })).status, 400);
  assert.equal((await call(admin, "/account/review-settings", "PUT", { email: "admin@example.com", emailEnabled: true })).status, 200);
  assert.equal((await call(admin, "/account/review-settings")).data.emailEnabled, true);
  const created = (await call(member, "/notes", "POST", { title: "新笔记", content: "新内容" })).data;
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_progress WHERE note_id=$1", [created.id])).rows[0].count, 3);
  await api.client.query("UPDATE note_review_progress SET due_on=$1 WHERE note_id=$2", [addCalendarDays(shanghaiDate(new Date()), -1), created.id]);
  await createDueReviewNotifications(api.client);
  assert.equal((await api.client.query("SELECT email_status FROM note_review_notifications WHERE user_id='admin' AND note_id=$1", [created.id])).rows[0].email_status, "pending");
  assert.equal((await call(admin, "/account/review-settings", "PUT", { email: "admin@example.com", emailEnabled: false })).status, 200);
  assert.equal((await api.client.query("SELECT email_status FROM note_review_notifications WHERE user_id='admin' AND note_id=$1", [created.id])).rows[0].email_status, "skipped");
  const newAccount = (await call(admin, "/users", "POST", { username: "newperson", password: "pw", name: "新人" })).data;
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_progress WHERE user_id=$1", [newAccount.id])).rows[0].count, 2);
  const before = (await api.client.query("SELECT generation FROM note_review_progress WHERE user_id='admin' AND note_id='old'")).rows[0].generation;
  await call(member, "/notes/old", "PATCH", { title: "改标题" });
  assert.equal((await api.client.query("SELECT generation FROM note_review_progress WHERE user_id='admin' AND note_id='old'")).rows[0].generation, before);
  await call(member, "/notes/old", "PATCH", { content: "新正文" });
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_progress WHERE note_id='old' AND generation=$1", [before + 1])).rows[0].count, 4);
  assert.equal((await call(admin, "/note-reviews/old/complete", "POST", { generation: before })).status, 409);
  assert.equal((await call(admin, "/note-reviews/old/complete", "POST", { generation: before + 1 })).status, 400);
  const yesterday = addCalendarDays(shanghaiDate(new Date()), -1);
  await api.client.query("UPDATE note_review_progress SET due_on=$1 WHERE note_id='old'", [yesterday]);
  const completed = await call(admin, "/note-reviews/old/complete", "POST", { generation: before + 1 });
  assert.equal(completed.status, 200);
  assert.equal(completed.data.step, 1);
  assert.equal(completed.data.dueOn, addCalendarDays(shanghaiDate(new Date()), 2));
  assert.equal((await call(admin, "/note-reviews/old/complete", "POST", { generation: before + 1 })).status, 409);
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_events WHERE user_id='admin' AND note_id='old'")).rows[0].count, 1);
  assert.equal((await call(member, "/note-reviews")).data.items.some(item => item.noteId === "old"), true);
  assert.equal((await call(admin, "/note-reviews")).data.items.some(item => item.noteId === "old"), false);
  for (const [index, days] of [4, 7, 15, 30, 30].entries()) {
    await api.client.query("UPDATE note_review_progress SET due_on=$1 WHERE user_id='admin' AND note_id='old'", [yesterday]);
    const next = await completeNoteReview(api.client, "admin", "old", before + 2 + index);
    assert.equal(next.status, "ok");
    assert.equal(next.dueOn, addCalendarDays(shanghaiDate(new Date()), days));
  }
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_events WHERE user_id='admin' AND note_id='old'")).rows[0].count, 6);
  const versions = (await call(admin, "/notes/old/versions")).data.items;
  const previousGeneration = (await api.client.query("SELECT generation FROM note_review_progress WHERE user_id='admin' AND note_id='old'")).rows[0].generation;
  await call(admin, "/notes/old/restore", "POST", { versionId: versions.at(-1).id });
  assert.equal((await api.client.query("SELECT generation,step FROM note_review_progress WHERE user_id='admin' AND note_id='old'")).rows[0].generation, previousGeneration + 1);
  assert.equal((await api.client.query("SELECT step FROM note_review_progress WHERE user_id='admin' AND note_id='old'")).rows[0].step, 0);
  await call(admin, "/notes/old", "DELETE");
  assert.equal((await api.client.query("SELECT count(*)::int AS count FROM note_review_progress WHERE note_id='old'")).rows[0].count, 4);
  assert.equal((await call(admin, "/note-reviews")).data.items.some(item => item.noteId === 'old'), false);
});

test("09:00 notifications catch up once, mark read, and skip SMTP without configuration", async t => {
  const fixture = basicFixture();
  fixture.notes = [{ id: "note", title: "复习测试", content: "正文", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
  const api = await createPgTestServer(t, fixture);
  await api.client.query("UPDATE note_review_progress SET due_on='2026-10-01' WHERE note_id='note'");
  assert.equal(await createDueReviewNotifications(api.client, new Date("2026-10-01T00:59:59Z")), 0);
  assert.equal(await createDueReviewNotifications(api.client, new Date("2026-10-01T01:00:00Z")), 3);
  assert.equal(await createDueReviewNotifications(api.client, new Date("2026-10-02T01:00:00Z")), 0);
  const login = await fetch(`${api.base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "admin123" }) });
  const { token } = await login.json();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const notifications = await (await fetch(`${api.base}/notifications`, { headers })).json();
  assert.equal(notifications.unread, 1);
  assert.equal(notifications.items.length, 1);
  assert.equal((await fetch(`${api.base}/notifications/${notifications.items[0].id}/read`, { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal((await (await fetch(`${api.base}/notifications`, { headers })).json()).unread, 0);
  assert.equal(await deliverReviewEmails(api.client, {}), 0);
});

test("SMTP delivery failure is recorded for retry without removing the in-app notice", async t => {
  const fixture = basicFixture();
  fixture.notes = [{ id: "mail-note", title: "邮件测试", content: "正文", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
  const api = await createPgTestServer(t, fixture);
  await api.client.query("UPDATE users SET review_email='a@example.com',review_email_enabled=true WHERE id='admin'");
  await api.client.query("UPDATE note_review_progress SET due_on='2026-10-01' WHERE note_id='mail-note'");
  await createDueReviewNotifications(api.client, new Date("2026-10-01T01:00:00Z"));
  const before = (await api.client.query("SELECT email_status,email_to FROM note_review_notifications WHERE user_id='admin'")).rows[0];
  assert.deepEqual(before, { email_status: "pending", email_to: "a@example.com" });
  const emailPool = new pg.Pool({ connectionString: api.url });
  // A refused local port simulates SMTP failure without contacting an external service.
  await deliverReviewEmails(emailPool, { SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", SMTP_FROM: "test@example.com" });
  await emailPool.end();
  const after = (await api.client.query("SELECT email_status,email_attempts,email_next_attempt_at,email_error,read_at FROM note_review_notifications WHERE user_id='admin'")).rows[0];
  assert.equal(after.email_status, "failed");
  assert.equal(after.email_attempts, 1);
  assert.ok(after.email_next_attempt_at);
  assert.ok(after.email_error);
  assert.equal(after.read_at, null);
});

test("SMTP delivery marks a pending notice as sent", async t => {
  const fixture = basicFixture();
  fixture.notes = [{ id: "mail-note", title: "发送成功", content: "正文", taskId: null, sourceSessionId: null, categoryId: null, tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
  const api = await createPgTestServer(t, fixture);
  await api.client.query("UPDATE users SET review_email='a@example.com',review_email_enabled=true WHERE id='admin'");
  await api.client.query("UPDATE note_review_progress SET due_on='2026-10-01' WHERE note_id='mail-note'");
  await createDueReviewNotifications(api.client, new Date("2026-10-01T01:00:00Z"));
  let accepted = 0;
  const smtp = createServer(socket => {
    socket.write("220 local test smtp\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", chunk => {
      buffer += chunk.toString();
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end).trimEnd();
        buffer = buffer.slice(end + 1);
        if (data) {
          if (line === ".") { data = false; accepted++; socket.write("250 accepted\r\n"); }
        } else if (line.startsWith("EHLO") || line.startsWith("HELO")) socket.write("250-localhost\r\n250 OK\r\n");
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 OK\r\n");
        else if (line === "DATA") { data = true; socket.write("354 end with dot\r\n"); }
        else if (line === "QUIT") { socket.write("221 bye\r\n"); socket.end(); }
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, "127.0.0.1", resolve));
  const pool = new pg.Pool({ connectionString: api.url });
  try {
    await deliverReviewEmails(pool, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(smtp.address().port), SMTP_FROM: "test@example.com" });
  } finally { await pool.end(); await new Promise(resolve => smtp.close(resolve)); }
  assert.equal(accepted, 1);
  const notice = (await api.client.query("SELECT email_status,email_attempts FROM note_review_notifications WHERE user_id='admin'")).rows[0];
  assert.deepEqual(notice, { email_status: "sent", email_attempts: 1 });
});

test("migration backfills old accounts and notes from the enablement day", async t => {
  const base = process.env.TEST_DATABASE_URL || "postgres://admin:admin_local_only@127.0.0.1:55432/agent_admin_test";
  const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() }); await admin.connect();
  const database = `admin_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(base); url.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: url.toString() }); await client.connect();
  t.after(async () => { await client.end(); await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); await admin.end(); });
  for (const name of ["001_initial", "002_constraints", "003_note_links", "004_media_assets", "005_note_taxonomy", "006_note_tag_catalog", "007_note_versions"]) {
    await client.query(readFileSync(new URL(`../db/migrations/${name}.sql`, import.meta.url), "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [name]);
  }
  await client.query("INSERT INTO users(id,username,password_hash,role,status) VALUES('a','a','x','admin','active'),('b','b','x','member','active')");
  await client.query("INSERT INTO notes(id,title,content,created_at,updated_at) VALUES('old','旧笔记','','2020-01-01','2020-01-01')");
  await migrate(client);
  const rows = (await client.query("SELECT user_id,step,to_char(due_on,'YYYY-MM-DD') AS due_on FROM note_review_progress ORDER BY user_id")).rows;
  assert.deepEqual(rows.map(row => row.user_id), ["a", "b"]);
  assert.deepEqual(rows.map(row => row.step), [0, 0]);
  assert.deepEqual(rows.map(row => row.due_on), [addCalendarDays(shanghaiDate(new Date()), 1), addCalendarDays(shanghaiDate(new Date()), 1)]);
});
