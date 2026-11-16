import { useEffect, useState } from "react";
import { openDb } from "./db/db";
import { getSociety, Society } from "./db/services";
import { makeT, Lang } from "./lib/i18n";
import { Setup, Dashboard, FlatsScreen, BillingScreen, BackupScreen, RulesScreen } from "./screens";

type Tab = "dashboard" | "flats" | "billing" | "rules" | "backup";
const TABS: Tab[] = ["dashboard", "flats", "billing", "rules", "backup"];

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [society, setSociety] = useState<Society | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [lang, setLang] = useState<Lang>((localStorage.getItem("lang") as Lang) || "en");
  const [dark, setDark] = useState(localStorage.getItem("theme") === "dark");
  const [version, setVersion] = useState(0); // bump to refresh screens after data changes
  const t = makeT(lang);

  useEffect(() => {
    openDb().then(() => { setSociety(getSociety()); setReady(true); }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { document.documentElement.lang = lang; localStorage.setItem("lang", lang); }, [lang]);

  const refresh = () => { setSociety(getSociety()); setVersion((v) => v + 1); };

  if (error) return <div className="shell"><p className="msg err">Could not open the database: {error}</p></div>;
  if (!ready) return <div className="shell"><p className="muted">…</p></div>;

  return (
    <div className="shell">
      <header className="top">
        <h1>{society ? society.name : t("app")}</h1>
        <div className="row" style={{ flex: "0 0 auto" }}>
          <button className="btn ghost" onClick={() => setLang(lang === "en" ? "mr" : "en")}>{t("language")}</button>
          <button className="btn ghost" onClick={() => setDark(!dark)} aria-label={t("theme")}>{dark ? "☀" : "☾"}</button>
        </div>
      </header>

      {!society ? (
        <Setup t={t} onDone={refresh} />
      ) : (
        <>
          <main key={version}>
            {tab === "dashboard" && <Dashboard t={t} society={society} />}
            {tab === "flats" && <FlatsScreen t={t} society={society} onChange={refresh} />}
            {tab === "billing" && <BillingScreen t={t} society={society} onChange={refresh} />}
            {tab === "rules" && <RulesScreen t={t} society={society} onChange={refresh} />}
            {tab === "backup" && <BackupScreen t={t} onRestored={refresh} />}
          </main>
          <nav className="tabs">
            {TABS.map((k) => (
              <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
                {t(k === "rules" ? "settings" : k)}
              </button>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
