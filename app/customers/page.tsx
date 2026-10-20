"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { readAllPages } from "@/lib/read-all-pages";
import { supabase } from "@/lib/supabase";
import { LocalizedTree, translate, useLanguage } from "@/app/components/LanguageProvider";
import { isValidOptionalPhone } from "@/lib/phone-validation.mjs";

type CustomerContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  job_address: string;
};

type ContactForm = Omit<CustomerContact, "id">;

const emptyForm: ContactForm = { name: "", email: "", phone: "", job_address: "" };
const mapsEmbedKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

function CustomerMap({ address, language }: { address: string; language: "en" | "es" }) {
  const [appleDevice, setAppleDevice] = useState(false);
  useEffect(() => {
    setAppleDevice(/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent));
  }, []);

  const destination = encodeURIComponent(address.trim());
  const directionsUrl = appleDevice
    ? `https://maps.apple.com/?daddr=${destination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`;
  const previewUrl = mapsEmbedKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsEmbedKey)}&q=${destination}`
    : null;

  return <div className="space-y-2">
    <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="group relative block aspect-square w-full max-w-80 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700" aria-label={language === "es" ? `Abrir indicaciones a ${address}` : `Open directions to ${address}`}>
      {previewUrl ? <iframe src={previewUrl} title={language === "es" ? `Vista previa del mapa de ${address}` : `Map preview of ${address}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" tabIndex={-1} aria-hidden="true" className="pointer-events-none h-full w-full border-0" /> : <span className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-100 to-blue-100 px-5 text-center text-slate-700"><span aria-hidden="true" className="text-5xl">⌖</span><span className="text-sm font-semibold">{language === "es" ? "Vista previa del mapa no configurada" : "Map preview not configured"}</span></span>}
      <span className="absolute bottom-3 left-3 right-3 rounded-lg bg-white/95 px-3 py-2 text-center text-sm font-semibold text-slate-900 shadow-sm group-hover:bg-white">{language === "es" ? "Abrir indicaciones ↗" : "Open directions ↗"}</span>
    </a>
    <p className="max-w-80 text-xs text-slate-600">{language === "es" ? "Confirma la dirección antes de iniciar el viaje." : "Confirm the address before starting your trip."}</p>
  </div>;
}

export default function CustomersPage() {
  const { language } = useLanguage();
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadContacts = useCallback(async () => {
    setLoading(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setError("Sign in to manage your saved customers.");
      setLoading(false);
      return;
    }

    const { data, error: loadError } = await readAllPages((from, to) => supabase
      .from("customer_contacts")
      .select("id, name, email, phone, job_address")
      .order("name", { ascending: true }).order("id").range(from, to));
    if (loadError) {
      setError("Saved customers are not available yet. The customer contacts database update must be applied first.");
      setContacts([]);
    } else {
      setContacts((data ?? []) as CustomerContact[]);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadContacts(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadContacts]);

  const visibleContacts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return contacts;
    return contacts.filter((contact) => [contact.name, contact.email, contact.phone, contact.job_address]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)));
  }, [contacts, search]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const job_address = form.job_address.trim();
    if (!name || name.length > 200 || email.length > 320 || !isValidOptionalPhone(phone) || phone.length > 80 || job_address.length > 500
      || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError(language === "es" ? "Revisa el nombre, correo, teléfono y dirección del cliente." : "Check the customer name, email, phone, and address.");
      return;
    }

    setSaving(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setError("Sign in to save a customer.");
      setSaving(false);
      return;
    }

    const values = { name, email, phone, job_address, updated_at: new Date().toISOString() };
    const { error: saveError } = editingId
      ? await supabase.from("customer_contacts").update(values).eq("id", editingId).eq("user_id", user.id)
      : await supabase.from("customer_contacts").insert({ ...values, user_id: user.id });
    if (saveError) {
      setError("Could not save this customer. Please try again.");
    } else {
      setNotice(editingId ? "Customer updated." : "Customer saved.");
      resetForm();
      await loadContacts();
    }
    setSaving(false);
  };

  const editContact = (contact: CustomerContact) => {
    setEditingId(contact.id);
    setForm({ name: contact.name, email: contact.email, phone: contact.phone, job_address: contact.job_address });
    setError("");
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteContact = async (contact: CustomerContact) => {
    if (!window.confirm(translate(language, `Delete ${contact.name} from saved customers? This does not delete existing estimates.`))) return;
    setError("");
    setNotice("");
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setError("Sign in to delete a customer.");
      return;
    }
    const { error: deleteError } = await supabase.from("customer_contacts").delete().eq("id", contact.id).eq("user_id", user.id);
    if (deleteError) setError("Could not delete this customer. Please try again.");
    else {
      if (editingId === contact.id) resetForm();
      if (openContactId === contact.id) setOpenContactId(null);
      setNotice("Customer deleted. Existing estimates are unchanged.");
      await loadContacts();
    }
  };

  return (
    <LocalizedTree>
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 md:px-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-orange-800">Free tools</p>
              <h1 className="mt-1 text-2xl font-bold">Saved customers</h1>
              <p className="mt-1 text-sm text-slate-600">Save contact details once and reuse them when preparing estimates.</p>
            </div>
            <Link href="#customer-form" className="inline-flex min-h-12 items-center rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">{editingId ? "Edit customer" : "+ Add customer"}</Link>
          </header>

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

          <section id="customer-form" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="customer-form-title">
            <h2 id="customer-form-title" className="text-lg font-bold">{editingId ? "Edit customer" : "Add a customer"}</h2>
            <p className="mt-1 text-sm text-slate-600">Only your account can view or manage these saved contacts.</p>
            <form onSubmit={(event) => void saveContact(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Customer name *
                <input required maxLength={200} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base" autoComplete="name" />
              </label>
              <label className="text-sm font-medium text-slate-700">Email
                <input type="email" maxLength={320} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base" autoComplete="email" />
              </label>
              <label className="text-sm font-medium text-slate-700">Phone
                <input type="tel" maxLength={80} value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base" autoComplete="tel" />
              </label>
              <label className="text-sm font-medium text-slate-700">Service address
                <input maxLength={500} value={form.job_address} onChange={(event) => setForm((current) => ({ ...current, job_address: event.target.value }))} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base" autoComplete="street-address" />
              </label>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button type="submit" disabled={saving} className="inline-flex min-h-12 items-center rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-60">{saving ? "Saving…" : editingId ? "Update customer" : "Save customer"}</button>
                {editingId && <button type="button" onClick={resetForm} className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel edit</button>}
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="saved-customer-list-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h2 id="saved-customer-list-title" className="font-semibold"><span>Your customers</span> ({contacts.length})</h2>
              <label className="sr-only" htmlFor="customer-search">Search customers</label>
              <input id="customer-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" className="min-h-12 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading customers…</p> : visibleContacts.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold">{contacts.length ? "No customers match that search." : "No saved customers yet."}</p>
                <p className="mt-1 text-sm text-slate-500">Add a contact here, then choose it from the customer picker on a new estimate.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibleContacts.map((contact) => (
                  <article key={contact.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{contact.name}</h3>
                        {contact.email && <p className="break-all text-sm text-slate-600">{contact.email}</p>}
                        {contact.phone && <p className="text-sm text-slate-600">{contact.phone}</p>}
                        {contact.job_address && <p className="text-sm text-slate-600">{contact.job_address}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" aria-expanded={openContactId === contact.id} onClick={() => setOpenContactId((current) => current === contact.id ? null : contact.id)} className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{openContactId === contact.id ? (language === "es" ? "Ocultar perfil" : "Hide profile") : (language === "es" ? "Ver perfil" : "View profile")}</button>
                        <button type="button" onClick={() => editContact(contact)} className="inline-flex min-h-12 items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                        <button type="button" onClick={() => void deleteContact(contact)} className="inline-flex min-h-12 items-center rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Delete</button>
                      </div>
                    </div>
                    {openContactId === contact.id && <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
                      <div className="space-y-2 text-sm">
                        <h4 className="font-semibold text-slate-900">{language === "es" ? "Perfil del cliente" : "Customer profile"}</h4>
                        <p className="text-slate-700">{contact.name}</p>
                        {contact.email && <a href={`mailto:${contact.email}`} className="block break-all font-medium text-blue-700 underline">{contact.email}</a>}
                        {contact.phone && <a href={`tel:${contact.phone}`} className="block font-medium text-blue-700 underline">{contact.phone}</a>}
                        <p className="text-slate-700">{contact.job_address || (language === "es" ? "Agrega una dirección de servicio para ver el mapa y las indicaciones." : "Add a service address to see the map and directions.")}</p>
                      </div>
                      {contact.job_address?.trim() && <CustomerMap address={contact.job_address} language={language} />}
                    </div>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </LocalizedTree>
  );
}
