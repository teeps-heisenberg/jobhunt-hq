'use server';

import { addNote, JobStatus, setStatus, updateJob } from '@jobhunt-hq/core';
import { revalidatePath } from 'next/cache';

import { getTracker } from '@/lib/db';

function revalidateJob(id: string) {
  revalidatePath('/');
  revalidatePath('/board');
  revalidatePath('/stats');
  revalidatePath(`/jobs/${id}`);
}

export async function moveJob(id: string, status: string, note?: string): Promise<void> {
  const parsed = JobStatus.parse(status);
  setStatus(getTracker().db, id, parsed, note ? { note } : {});
  revalidateJob(id);
}

export async function moveJobForm(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();
  await moveJob(id, status, note || undefined);
}

export async function addNoteForm(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const text = String(formData.get('text') ?? '').trim();
  if (!id || !text) return;
  addNote(getTracker().db, id, text);
  revalidateJob(id);
}

export async function setFollowUpForm(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const date = String(formData.get('followUpAt') ?? '').trim();
  if (!id) return;
  updateJob(getTracker().db, id, { followUpAt: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null });
  revalidateJob(id);
}
