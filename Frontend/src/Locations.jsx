import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";

const emptyForm = { name: "", description: "" };

export default function Locations({ refreshKey }) {
  const [locations, setLocations] = useState([]);
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
    setLoading(true);
    setError("");
    api("/super-admin/locations")
      .then((data) => { if (active) setLocations(data.locations); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function openEditor(location) {
    setEditing(location?.id || null);
    setForm(location ? { name: location.name, description: location.description || "" } : emptyForm);
    setDialogError("");
    setMessage("");
    setDeleting(null);
    editor.current.showModal();
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setDialogError("");
    try {
      const { location } = await api(
        `/super-admin/locations${editing ? `/${editing}` : ""}`,
        form,
        editing ? "PUT" : "POST",
      );
      setLocations((items) => [
        ...items.filter((item) => item.id !== location.id),
        location,
      ].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage(editing ? "Location updated." : "Location created.");
      editor.current.close();
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/super-admin/locations/${id}`, undefined, "DELETE");
      setLocations((items) => items.filter((item) => item.id !== id));
      setDeleting(null);
      setMessage("Location deleted.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = locations.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()),
  );

  return <section aria-label="Manage locations">
    {error && <div className="error" role="alert">{error}</div>}
    <p className="department-status" role="status">{message}</p>
    <section className="department-list compact-departments" aria-busy={loading}>
      <div className="department-list-heading">
        <div className="department-title"><h2>Locations</h2><span className="badge">{locations.length} total</span></div>
        <button className="primary" type="button" disabled={busy || loading} onClick={() => openEditor(null)}>+ Create location</button>
      </div>
      <div className="department-toolbar">
        <input type="search" aria-label="Search locations" placeholder="Search locations…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {loading ? <p className="muted" role="status">Loading locations…</p>
        : locations.length === 0 ? <p className="muted">No locations yet. Create your first location to get started.</p>
        : filtered.length === 0 ? <p className="muted">No locations match your search.</p>
        : filtered.map((location) => <article className="department-item department-row company-row" key={location.id} aria-label={location.name}>
          <div><h3>{location.name}</h3>{location.description && <p className="muted department-description">{location.description}</p>}</div>
          {deleting === location.id ? <div className="delete-confirmation department-row-confirmation">
            <p>Delete “{location.name}”? This cannot be undone.</p>
            <div className="department-actions">
              <button className="danger" type="button" disabled={busy} onClick={() => remove(location.id)}>{busy ? "Deleting…" : "Confirm delete"}</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => setDeleting(null)}>Keep location</button>
            </div>
          </div> : <div className="department-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => openEditor(location)}>Edit</button>
            <button className="danger" type="button" disabled={busy} onClick={() => setDeleting(location.id)}>Delete</button>
          </div>}
        </article>)}
    </section>
    <dialog ref={editor} className="user-editor-dialog department-editor" aria-labelledby="location-editor-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className="user-dialog-heading">
        <h2 id="location-editor-title">{editing ? "Edit location" : "Create location"}</h2>
        <button type="button" className="user-dialog-close" aria-label="Close location form" disabled={busy} onClick={() => editor.current.close()}>&times;</button>
      </header>
      {dialogError && <div className="error" role="alert">{dialogError}</div>}
      <form onSubmit={save}>
        <label htmlFor="location-name">Location name
          <input id="location-name" autoFocus required minLength={2} maxLength={100} value={form.name} disabled={busy} placeholder="e.g. Head Office" onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label htmlFor="location-description">Location description (optional)
          <textarea id="location-description" maxLength={500} rows={3} value={form.description} disabled={busy} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <div className="department-actions">
          <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create location"}</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => editor.current.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  </section>;
}
