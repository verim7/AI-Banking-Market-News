-- Default permissions, roles and role→permission grants.
-- Idempotent: safe to re-run after a migration.
--
-- No user is seeded here on purpose: a hard-coded default password in a git
-- repository is a backdoor, not a convenience. Create the first admin with
--   npm run create-admin -- --email you@example.com
-- which hashes the password locally and prints the INSERT to run.

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('articles.read',   'View news, Market Lens and the archive'),
  ('favorites.write', 'Add and remove personal favourites'),
  ('hil.review',      'Mark articles relevant / not relevant in the HIL Checker'),
  ('hil.export',      'Export selected articles as CSV or Excel'),
  ('sources.manage',  'Enable, disable and add news sources'),
  ('admin.users',     'Create users and assign roles'),
  ('admin.roles',     'Create roles, grant permissions and set role scopes');

INSERT OR IGNORE INTO roles (id, name, description, built_in) VALUES
  ('role_admin',   'Administrator', 'Full access including user and role management', 1),
  ('role_analyst', 'Analyst',       'Reads everything, triages and exports for Market Lens', 1),
  ('role_viewer',  'Viewer',        'Read-only access to news, Market Lens and the archive', 1);

INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES
  ('role_admin', 'articles.read'),
  ('role_admin', 'favorites.write'),
  ('role_admin', 'hil.review'),
  ('role_admin', 'hil.export'),
  ('role_admin', 'sources.manage'),
  ('role_admin', 'admin.users'),
  ('role_admin', 'admin.roles'),

  ('role_analyst', 'articles.read'),
  ('role_analyst', 'favorites.write'),
  ('role_analyst', 'hil.review'),
  ('role_analyst', 'hil.export'),

  ('role_viewer', 'articles.read'),
  ('role_viewer', 'favorites.write');
