import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./Icon.tsx";
import { useSupabaseAuth } from "../lib/supabase/auth.tsx";

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SupabaseAccountSettings() {
  const auth = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [shareEnabledDraft, setShareEnabledDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(auth.profile?.display_name ?? "");
  }, [auth.profile?.display_name]);

  useEffect(() => {
    setShareEnabledDraft(auth.profile?.share_enabled ?? true);
  }, [auth.profile?.share_enabled]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await auth.signIn(email, password);
      setPassword("");
    } catch (caught) {
      setActionError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await auth.setDisplayName(displayName);
      setNotice("Zapisano nazwę profilu.");
    } catch (caught) {
      setActionError(messageFor(caught));
    } finally {
      setProfileBusy(false);
    }
  }

  async function toggleSharing(enabled: boolean) {
    if (profileBusy) return;
    setShareEnabledDraft(enabled);
    setProfileBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await auth.setShareEnabled(enabled);
      setNotice(enabled ? "Udostępnianie włączone." : "Udostępnianie wyłączone.");
    } catch (caught) {
      setShareEnabledDraft(auth.profile?.share_enabled ?? true);
      setActionError(messageFor(caught));
    } finally {
      setProfileBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      await auth.signOut();
    } catch (caught) {
      setActionError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="section-heading">
        <div><span className="eyebrow">Wspólna mapa</span><h2>Konto i lokalizacja</h2></div>
        <span className="section-status">{auth.user ? "Zalogowano" : "Opcjonalne"}</span>
      </div>

      {auth.authLoading ? (
        <div className="settings-card"><p className="settings-locked">Sprawdzam sesję…</p></div>
      ) : !auth.user ? (
        <form className="settings-card cloud-login-card" onSubmit={(event) => void signIn(event)}>
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-green"><Icon name="map" size={19} /></div>
            <div><h3>Zaloguj do grupy</h3><p>Po zalogowaniu możesz widzieć innych użytkowników na Mapie.</p></div>
          </div>
          <label className="cloud-field">
            <span>E-mail</span>
            <input autoComplete="username" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="cloud-field">
            <span>Hasło</span>
            <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <p className="cloud-login-hint">Konto musi być wcześniej utworzone lub zaproszone; formularza rejestracji nie ma w PWA.</p>
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? <><span className="spinner spinner-light" /> Loguję…</> : "Zaloguj"}
          </button>
        </form>
      ) : (
        <div className="settings-card cloud-account-card">
          <div className="settings-card-heading">
            <div className="settings-icon settings-icon-green"><Icon name="check" size={19} /></div>
            <div><h3>Zalogowano</h3><p>{auth.user.email}</p></div>
            <button className="button button-ghost" disabled={busy || profileBusy || auth.signingOut} onClick={() => void signOut()} type="button">
              {auth.signingOut ? "Wylogowuję…" : "Wyloguj"}
            </button>
          </div>

          {auth.profileLoading ? (
            <p className="settings-locked">Przygotowuję profil…</p>
          ) : auth.profile ? (
            <>
              <form className="cloud-profile-form" onSubmit={(event) => void saveDisplayName(event)}>
                <label className="cloud-field">
                  <span>Nazwa na mapie</span>
                  <input maxLength={32} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
                </label>
                <button className="button button-ghost" disabled={profileBusy || displayName.trim() === auth.profile.display_name} type="submit">
                  Zapisz nazwę
                </button>
              </form>

              <label className="cloud-sharing-toggle">
                <span><strong>Udostępniaj moją pozycję</strong><small>Wysyłanie działa tylko na widoku Mapy, gdy PWA odbiera GPS.</small></span>
                <input
                  checked={shareEnabledDraft}
                  disabled={profileBusy}
                  onChange={(event) => void toggleSharing(event.target.checked)}
                  type="checkbox"
                />
              </label>
            </>
          ) : (
            <p className="settings-locked">Nie udało się wczytać profilu. Sprawdź połączenie ze schematem `szusownik`.</p>
          )}
        </div>
      )}

      {(actionError || auth.error) && <p className="cloud-feedback cloud-feedback-error" role="alert">{actionError ?? auth.error}</p>}
      {notice && <p className="cloud-feedback" role="status">{notice}</p>}
    </section>
  );
}
