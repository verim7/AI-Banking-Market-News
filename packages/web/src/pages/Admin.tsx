import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type TaxonomyDimension } from '../api.ts';

type Role = Awaited<ReturnType<typeof api.admin.roles>>['roles'][number];
type User = Awaited<ReturnType<typeof api.admin.users>>['users'][number];
type Source = Awaited<ReturnType<typeof api.admin.sources>>['sources'][number];

export function Admin({ taxonomy, me }: { taxonomy: TaxonomyDimension[]; me: Me }) {
  const canRoles = me.permissions.includes('admin.roles');
  const canUsers = me.permissions.includes('admin.users');
  const canSources = me.permissions.includes('sources.manage');

  const [roles, setRoles] = useState<Role[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<{ key: string; description: string }[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [lastRun, setLastRun] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      if (canRoles) {
        const r = await api.admin.roles();
        setRoles(r.roles);
        setAvailablePermissions(r.availablePermissions);
      }
      if (canUsers) setUsers((await api.admin.users()).users);
      if (canSources) {
        const s = await api.admin.sources();
        setSources(s.sources);
        setLastRun(s.lastRun);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [canRoles, canUsers, canSources]);

  useEffect(() => { void refresh(); }, [refresh]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await fn();
      setNotice(message);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h2>Administration</h2>
      <p className="subtle">Users, roles, what each role may see, and source health.</p>

      {notice && <div className="banner info">{notice}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="stack">
        {canRoles && (
          <RolesPanel
            roles={roles}
            availablePermissions={availablePermissions}
            taxonomy={taxonomy}
            act={act}
          />
        )}
        {canUsers && <UsersPanel users={users} roles={roles} act={act} />}
        {canSources && <SourcesPanel sources={sources} lastRun={lastRun} act={act} />}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- roles */

function RolesPanel({ roles, availablePermissions, taxonomy, act }: {
  roles: Role[];
  availablePermissions: { key: string; description: string }[];
  taxonomy: TaxonomyDimension[];
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="card">
      <h2>Roles</h2>
      <p className="subtle">
        Permissions decide what a role may do. Scopes decide which articles it may
        see — a role with no scopes sees everything.
      </p>

      <table>
        <thead>
          <tr>
            <th>Role</th><th>Permissions</th><th>Visibility</th><th />
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.name}</strong>
                {r.builtIn && <span className="chip" style={{ marginLeft: 6 }}>built-in</span>}
                <div className="muted" style={{ fontSize: 12 }}>{r.description}</div>
              </td>
              <td>
                <div className="chips">
                  {r.permissions.length === 0
                    ? <span className="muted">none</span>
                    : r.permissions.map((p) => <span key={p} className="chip">{p}</span>)}
                </div>
              </td>
              <td>
                {r.scopes.length === 0
                  ? <span className="chip accent">everything</span>
                  : (
                    <div className="chips">
                      {r.scopes.map((s) => (
                        <span key={`${s.dimension}:${s.value}`} className="chip">
                          {s.dimension}: {s.value}
                        </span>
                      ))}
                    </div>
                  )}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button onClick={() => setEditing(editing === r.id ? null : r.id)}>
                  {editing === r.id ? 'Close' : 'Edit'}
                </button>
                {!r.builtIn && (
                  <button
                    style={{ marginLeft: 6 }}
                    onClick={() => act(() => api.admin.deleteRole(r.id), `Deleted ${r.name}.`)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <RoleEditor
          role={roles.find((r) => r.id === editing)!}
          availablePermissions={availablePermissions}
          taxonomy={taxonomy}
          act={act}
        />
      )}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <input
          placeholder="New role name" value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <input
          placeholder="Description" value={description} style={{ minWidth: 220 }}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => act(
            async () => {
              await api.admin.createRole(name.trim(), description);
              setName(''); setDescription('');
            },
            `Created role ${name.trim()}.`,
          )}
        >
          Add role
        </button>
      </div>
    </section>
  );
}

function RoleEditor({ role, availablePermissions, taxonomy, act }: {
  role: Role;
  availablePermissions: { key: string; description: string }[];
  taxonomy: TaxonomyDimension[];
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [permissions, setPermissions] = useState<string[]>(role.permissions);
  const [scopes, setScopes] = useState(role.scopes);

  useEffect(() => {
    setPermissions(role.permissions);
    setScopes(role.scopes);
  }, [role]);

  const togglePermission = (key: string, on: boolean) =>
    setPermissions((prev) => (on ? [...new Set([...prev, key])] : prev.filter((p) => p !== key)));

  const toggleScope = (dimension: string, value: string, on: boolean) =>
    setScopes((prev) => (on
      ? [...prev, { dimension, value }]
      : prev.filter((s) => !(s.dimension === dimension && s.value === value))));

  const hasScope = (dimension: string, value: string) =>
    scopes.some((s) => s.dimension === dimension && s.value === value);

  return (
    <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)' }}>
      <h2>Editing “{role.name}”</h2>

      <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>Permissions</h3>
      <div className="grid cols-2">
        {availablePermissions.map((p) => (
          <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={permissions.includes(p.key)}
              onChange={(e) => togglePermission(p.key, e.currentTarget.checked)}
            />
            <span>
              <code>{p.key}</code>
              <div className="muted" style={{ fontSize: 12 }}>{p.description}</div>
            </span>
          </label>
        ))}
      </div>

      <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>Visibility scope</h3>
      <p className="subtle">
        Tick nothing to let this role see everything. Within a dimension the ticks
        are OR-ed; across dimensions they are AND-ed.
      </p>

      <div className="grid cols-2">
        {taxonomy.map((dim) => (
          <div key={dim.dimension}>
            <strong style={{ fontSize: 12 }}>{dim.label}</strong>
            <div style={{ marginTop: 4 }}>
              {dim.values.map((v) => (
                <label
                  key={v.value}
                  style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={hasScope(dim.dimension, v.value)}
                    onChange={(e) => toggleScope(dim.dimension, v.value, e.currentTarget.checked)}
                  />
                  {v.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button
          className="primary"
          onClick={() => act(
            async () => {
              await api.admin.setRolePermissions(role.id, permissions);
              await api.admin.setRoleScopes(role.id, scopes);
            },
            `Saved ${role.name}.`,
          )}
        >
          Save role
        </button>
        <span className="muted">
          {scopes.length === 0 ? 'Sees everything' : `Restricted by ${scopes.length} scope rule(s)`}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- users */

function UsersPanel({ users, roles, act }: {
  users: User[];
  roles: Role[];
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);

  return (
    <section className="card">
      <h2>Users</h2>
      <p className="subtle">Passwords must be at least 12 characters.</p>

      <table>
        <thead>
          <tr><th>Email</th><th>Name</th><th>Roles</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.displayName || <span className="muted">—</span>}</td>
              <td>
                <select
                  multiple
                  style={{ minWidth: 160, minHeight: 60 }}
                  value={u.roles.map((r) => r.id)}
                  onChange={(e) => {
                    const next = [...e.currentTarget.selectedOptions].map((o) => o.value);
                    void act(() => api.admin.setUserRoles(u.id, next), `Updated roles for ${u.email}.`);
                  }}
                >
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </td>
              <td>
                <span className="chip" style={u.active ? { color: 'var(--good)' } : undefined}>
                  {u.active ? 'active' : 'disabled'}
                </span>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button
                  onClick={() => act(
                    () => api.admin.setUserActive(u.id, !u.active),
                    `${u.active ? 'Disabled' : 'Enabled'} ${u.email}.`,
                  )}
                >
                  {u.active ? 'Disable' : 'Enable'}
                </button>
                <button
                  style={{ marginLeft: 6 }}
                  onClick={() => {
                    const pw = window.prompt(`New password for ${u.email} (min 12 characters)`);
                    if (pw) {
                      void act(
                        () => api.admin.setUserPassword(u.id, pw),
                        `Password reset for ${u.email}; their sessions were ended.`,
                      );
                    }
                  }}
                >
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="toolbar" style={{ marginTop: 16, alignItems: 'flex-end' }}>
        <input placeholder="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <input placeholder="display name" value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
        <input placeholder="password (min 12)" type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <select
          multiple style={{ minHeight: 60 }} value={roleIds}
          onChange={(e) => setRoleIds([...e.currentTarget.selectedOptions].map((o) => o.value))}
        >
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button
          className="primary"
          disabled={!email.trim() || password.length < 12}
          onClick={() => act(
            async () => {
              await api.admin.createUser(email.trim(), displayName, password, roleIds);
              setEmail(''); setDisplayName(''); setPassword(''); setRoleIds([]);
            },
            `Created ${email.trim()}.`,
          )}
        >
          Add user
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ sources */

function SourcesPanel({ sources, lastRun, act }: {
  sources: Source[];
  lastRun: Record<string, unknown> | null;
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const failures = (() => {
    if (!lastRun?.['detail']) return [];
    try {
      const detail = JSON.parse(String(lastRun['detail'])) as {
        sources?: { id: string; name: string; ok: boolean; error?: string }[];
      };
      return (detail.sources ?? []).filter((s) => !s.ok);
    } catch {
      return [];
    }
  })();

  return (
    <section className="card">
      <h2>Sources</h2>
      <p className="subtle">
        Feeds the daily job reads. Disabling one here stops it being written on the
        next run; the source list itself lives in <code>packages/ingest/src/sources.yaml</code>.
      </p>

      {lastRun ? (
        <div className="banner info">
          Last run {String(lastRun['started_at'])} — status <strong>{String(lastRun['status'])}</strong>,
          {' '}{String(lastRun['items_fetched'])} fetched, {String(lastRun['items_new'])} new,
          {' '}{String(lastRun['sources_ok'])} sources ok, {String(lastRun['sources_failed'])} failed.
        </div>
      ) : (
        <div className="banner info">No ingest run recorded yet.</div>
      )}

      {failures.length > 0 && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer' }}>
            {failures.length} source(s) failed on the last run
          </summary>
          <ul style={{ fontSize: 12 }}>
            {failures.map((f) => <li key={f.id}><strong>{f.name}</strong>: {f.error}</li>)}
          </ul>
        </details>
      )}

      <table>
        <thead>
          <tr><th>Source</th><th>Type</th><th>Region hint</th><th>Enabled</th></tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>
                {s.name}
                <div className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{s.url}</div>
              </td>
              <td><span className="chip">{s.publisher_kind}</span> <span className="chip">{s.kind}</span></td>
              <td className="muted">{s.region_hint ?? '—'}</td>
              <td>
                <input
                  type="checkbox"
                  checked={s.enabled === 1}
                  aria-label={`Enable ${s.name}`}
                  onChange={(e) => act(
                    () => api.admin.setSourceEnabled(s.id, e.currentTarget.checked),
                    `Updated ${s.name}.`,
                  )}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
