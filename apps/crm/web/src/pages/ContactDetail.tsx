import { useNavigate, useParams } from 'react-router-dom';
import { useContact, useDeleteEntity } from '../hooks/use-api.js';
import { ArrowLeft, Mail, Phone, Building2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import ActivityTimeline from '../components/ActivityTimeline.js';
import ActivityForm from '../components/ActivityForm.js';
import ContactForm from '../components/forms/ContactForm.js';
import type { ActivityType } from '../api.js';

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useContact(id ?? '');
  const deleteMutation = useDeleteEntity();
  const [editOpen, setEditOpen] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType | null>(null);

  if (isLoading) return <div className="text-slate-500">Loading contact...</div>;
  if (!data?.contact) return <div className="text-slate-500">Contact not found</div>;

  const contact = data.contact;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/contacts')}
        className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={16} /> Back to contacts
      </button>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-600 text-white flex items-center justify-center text-lg font-medium">
              {contact.firstName.charAt(0)}{contact.lastName.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-semibold">{contact.firstName} {contact.lastName}</h1>
              <div className="text-slate-500 text-sm">{contact.email}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditOpen(true)} className="p-2 rounded hover:bg-slate-100 text-slate-500">
              <Pencil size={16} />
            </button>
            <button
              onClick={() => {
                deleteMutation.mutate({ type: 'contacts', id: contact.id }, { onSuccess: () => navigate('/contacts') });
              }}
              className="p-2 rounded hover:bg-red-100 text-red-500"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <div className="flex items-center gap-2 text-sm">
            <Mail size={16} className="text-slate-400" />
            <span>{contact.email}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Phone size={16} className="text-slate-400" />
            <span>{contact.phone ?? 'No phone'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Building2 size={16} className="text-slate-400" />
            <span>{contact.title ?? 'No title'}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <ActivityTimeline
          filters={{ contactId: contact.id }}
          entityName={`${contact.firstName} ${contact.lastName}`}
          onAddActivity={(type) => setActivityType(type)}
        />
      </div>

      <ContactForm open={editOpen} onClose={() => setEditOpen(false)} contact={contact} />
      {activityType && (
        <ActivityForm
          open={!!activityType}
          onClose={() => setActivityType(null)}
          type={activityType}
          filters={{ contactId: contact.id }}
          entityName={`${contact.firstName} ${contact.lastName}`}
        />
      )}
    </div>
  );
}
