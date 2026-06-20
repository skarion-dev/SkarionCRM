import { useState } from 'react';
import { useContacts, useDeleteEntity } from '../hooks/use-api.js';
import { Contact as ContactIcon, Plus, Search, Trash2, Pencil, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ContactForm from '../components/forms/ContactForm.js';
import type { Contact } from '../api.js';

export default function ContactsPage() {
  const { data, isLoading } = useContacts();
  const deleteMutation = useDeleteEntity();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  const openCreate = () => { setEditContact(null); setModalOpen(true); };
  const openEdit = (contact: Contact) => { setEditContact(contact); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditContact(null); };

  const contacts = data?.contacts.filter((c) => !c.deletedAt) ?? [];
  const filtered = contacts.filter((c) =>
    !search || c.email.toLowerCase().includes(search.toLowerCase()) ||
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    (c.title ?? '').toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) return <div className="text-slate-500">Loading contacts...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ContactIcon size={20} className="text-slate-600" />
          <h1 className="text-xl font-semibold">Contacts</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700">
          <Plus size={16} /> Add Contact
        </button>
      </div>

      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
        <Search size={16} className="text-slate-400" />
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 text-sm outline-none"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Title</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Phone</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr
                  key={contact.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => navigate(`/contacts/${contact.id}`)}
                >
                  <td className="px-4 py-3 font-medium">{contact.firstName} {contact.lastName}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.email}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.title ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{contact.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(contact); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/contacts/${contact.id}`); }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500"
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ type: 'contacts', id: contact.id }); }}
                        className="p-1.5 rounded hover:bg-red-100 text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No contacts found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ContactForm open={modalOpen} onClose={closeModal} contact={editContact} />
    </div>
  );
}
