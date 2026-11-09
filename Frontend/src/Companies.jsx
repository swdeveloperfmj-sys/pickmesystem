import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";

const emptyForm = { name: "", description: "" };

export default function Companies({ refreshKey }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const editor = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api("/super-admin/companies")
      .then((data) => { if (active) setCompanies(data.companies); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function openEditor(company) {
    setEditing(company?.id || null);
    setForm(company ? { name: company.name, description: company.description || "" } : emptyForm);
    setDialogError(""); setMessage(""); setDeleting(null);
    editor.current.showModal();
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setDialogError("");
    try {
      const { company } = await api(`/super-admin/companies${editing ? `/${editing}` : ""}`, form, editing ? "PUT" : "POST");
      setCompanies((items) => [...items.filter((item) => item.id !== company.id), company].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? "Company updated." : "Company created.");
      editor.current.close();
    } catch (err) { setDialogError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(id) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/super-admin/companies/${id}`, undefined, "DELETE");
      setCompanies((items) => items.filter((item) => item.id !== id));
      setDeleting(null); setMessage("Company deleted.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const filtered = companies.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section aria-label="Manage companies">
    {error && <div className="error" role="alert">{error}</div>}
    <p className="department-status" role="status">{message}</p>
    <section className="department-list compact-departments" aria-busy={loading}>
      <div className="department-list-heading">
        <div className="department-title"><h2>Companies</h2><span className="badge">{companies.length} total</span></div>
        <button className="primary" type="button" disabled={busy || loading} onClick={() => openEditor(null)}>+ Create company</button>
      </div>
      <div className="department-toolbar"><input type="search" aria-label="Search companies" placeholder="Search companiesâ€¦" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {loading ? <p className="muted" role="status">Loading companiesâ€¦</p>
        : companies.length === 0 ? <p className="muted">No companies yet. Create your first company to get started.</p>
        : filtered.length === 0 ? <p className="muted">No companies match your search.</p>
        : filtered.map((company) => <article className="department-item department-row company-row" key={company.id} aria-label={company.name}>
          <div><h3>{company.name}</h3>{company.description && <p className="muted department-description">{company.description}</p>}</div>
          {deleting === company.id ? <div className="delete-confirmation department-row-confirmation">
            <p>Delete â€œ{company.name}â€? This cannot be undone.</p>
            <div className="department-actions"><button className="danger" type="button" disabled={busy} onClick={() => remove(company.id)}>{busy ? "Deletingâ€¦" : "Confirm delete"}</button><button className="secondary" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep company</button></div>
          </div> : <div className="department-actions"><button className="secondary" type="button" disabled={busy} onClick={() => openEditor(company)}>Edit</button><button className="danger" type="button" disabled={busy} onClick={() => setDeleting(company.id)}>Delete</button></div>}
        </article>)}
    </section>
    <dialog ref={editor} className="user-editor-dialog department-editor" aria-labelledby="company-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className="user-dialog-heading"><h2 id="company-editor-title">{editing ? "Edit company" : "Create company"}</h2><button type="button" className="user-dialog-close" aria-label="Close company form" disabled={busy} onClick={() => editor.current.close()}>&times;</button></header>
      {dialogError && <div className="error" role="alert">{dialogError}</div>}
      <form onSubmit={save}>
        <label htmlFor="company-name">Company name<input id="company-name" autoFocus required minLength={2} maxLength={100} value={form.name} disabled={busy} placeholder="e.g. Acme Holdings" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label htmlFor="company-description">Company description (optional)<textarea id="company-description" maxLength={500} rows={3} value={form.description} disabled={busy} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="department-actions"><button className="primary" type="submit" disabled={busy}>{busy ? "Savingâ€¦" : editing ? "Save changes" : "Create company"}</button><button className="secondary" type="button" disabled={busy} onClick={() => editor.current.close()}>Cancel</button></div>
      </form>
    </dialog>
  </section>;
}

