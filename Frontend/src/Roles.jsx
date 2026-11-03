import React, { useState } from "react";
import { api } from "./api";

export default function Roles({ roles, loading, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function create(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/super-admin/roles", { name, description });
      onCreated(result.role);
      setName(""); setDescription("");
      setMessage("Role created. You can now assign it from the Users section.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <section className="page-enter" aria-label="Manage roles">
      {error && <div className="error" role="alert">{error}</div>}
      <p role="status" className="department-status">{message}</p>
      <div className="department-layout">
        <section className="department-form-card">
          <span className="eyebrow accent">ORGANIZE YOUR PEOPLE</span>
          <h2>Create role</h2>
          <p className="muted">Create a role for your organization, then assign it when creating or editing a user.</p>
          <form onSubmit={create}>
            <label htmlFor="role-name">Role name
              <input id="role-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} placeholder="e.g. Transport Coordinator" disabled={busy || loading} />
            </label>
            <label htmlFor="role-description">Role description (optional)
              <textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={4} disabled={busy || loading} />
            </label>
            <button type="submit" className="primary" disabled={busy || loading}>{busy ? "Creating…" : "Create role"}</button>
          </form>
          <p className="muted role-note">New roles identify users’ responsibilities. They do not grant access to the Super Administrator portal.</p>
        </section>
        <section className="department-list" aria-label="Role list" aria-busy={loading}>
          <div className="department-list-heading"><h2>Available roles</h2><span className="badge">{roles.length} total</span></div>
          {loading ? <p role="status" className="muted">Loading roles…</p> : roles.map((role) => (
            <article className="department-item" key={role.value} aria-label={role.name}>
              <div className="role-heading"><h3>{role.name}</h3><span className="badge">{role.builtIn ? "Built-in" : "Custom"}</span></div>
              <p className="muted">{role.description || "No description added."}</p>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
