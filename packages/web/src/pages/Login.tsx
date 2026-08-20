import { useState } from 'react';
import { api } from '../api.ts';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h2>AI Banking Market News</h2>
        <p className="subtle">Sign in to continue.</p>

        {error && <div className="banner error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          {/* iOS capitalises and autocorrects the first word of a text field
              by default, which quietly mangles an address typed on a phone. */}
          <input
            id="email" type="email" autoComplete="username" required
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={email} onChange={(e) => setEmail(e.currentTarget.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>

        <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
