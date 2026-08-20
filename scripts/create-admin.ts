#!/usr/bin/env node
/**
 * Create the first administrator, or reset an existing one's password.
 *
 * The password is hashed here, on your machine, with the same PBKDF2 parameters
 * the Worker uses to verify it. Only the hash and salt reach the database, and
 * no default password is ever committed to the repository.
 *
 *   npm run create-admin -- --email you@example.com
 *   npm run create-admin -- --email you@example.com --password '…' --apply
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { hashPassword } from '../packages/worker/src/auth.ts';

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const email = arg('--email');
const remote = process.argv.includes('--remote');
const apply = process.argv.includes('--apply');

if (!email) {
  console.error('Usage: npm run create-admin -- --email you@example.com [--password …] [--apply] [--remote]');
  process.exit(1);
}

let password = arg('--password');
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password (min 12 characters): ');
  rl.close();
}

if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const { hash, salt } = await hashPassword(password);
const id = `user_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const safeEmail = email.trim().toLowerCase().replace(/'/g, "''");

// Idempotent: creates the administrator, or resets the password of the one
// that already has this address. Re-running is the supported way to recover a
// forgotten password, and was needed once already when the PBKDF2 iteration
// count changed and every stored hash stopped verifying.
//
// Changing a password invalidates existing sessions — otherwise a reset would
// leave whoever held the old cookie still signed in.
const sql = `INSERT INTO users (id, email, display_name, password_hash, password_salt, active)
VALUES ('${id}', '${safeEmail}', '${safeEmail}', '${hash}', '${salt}', 1)
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  active = 1;
INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, 'role_admin' FROM users WHERE email = '${safeEmail}';
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${safeEmail}');`;

if (!apply) {
  console.log('\n-- Run this against your D1 database:\n');
  console.log(sql);
  console.log(`\n-- Or re-run with --apply${remote ? '' : ' (add --remote for the deployed database)'}.`);
  process.exit(0);
}

const target = remote ? '--remote' : '--local';
const d1 = (command: string, stdio: 'inherit' | 'pipe') =>
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'portal', target, '--command', command, '--yes'],
               { stdio, encoding: 'utf8' });

// Without this, a skipped schema step surfaces as a raw "no such table: users"
// from SQLite, which says nothing about which command was missed.
try {
  d1('SELECT count(*) FROM users;', 'pipe');
} catch {
  console.error(
    `\nThe ${remote ? 'remote' : 'local'} database has no tables yet, so there is nowhere to `
    + `put this user.\n\nRun this first:\n  npm run db:${remote ? 'remote' : 'local'}\n`);
  process.exit(1);
}

console.log(`Applying to the ${remote ? 'remote' : 'local'} database…`);
d1(sql, 'inherit');
console.log(`\nAdministrator ${safeEmail} is ready. Any existing sessions were signed out.`);
