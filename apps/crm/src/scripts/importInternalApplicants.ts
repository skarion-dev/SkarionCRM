/**
 * Import the Outlook-derived applicant tracker into the dedicated CRM
 * recruiting tables. This script is intentionally idempotent on applicant
 * number, message ID, and document checksum.
 *
 * Required environment variables:
 *   DATABASE_URL, APPLICANT_JSON, RAW_EMAIL_JSON, SOURCE_ROOT
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

type ApplicantInput = {
  applicant_id: string;
  name: string;
  email: string;
  phone?: string;
  role_applied?: string;
  status?: string;
  first_received?: string;
  last_received?: string;
  message_count?: number;
  university?: string;
  school?: string;
  education_location?: string;
  gpa?: number | null;
  graduation_year?: number | null;
  skills?: string;
  skill_count?: number;
  culture_evidence_count?: number;
  school_outside_dhaka?: boolean;
  project_evidence_count?: number;
  completeness_count?: number;
  resume_names?: string[];
  resume_files_final?: string[];
  source_message_ids?: string[];
  raw_email_text?: string;
  raw_email_truncated?: boolean;
  resume_text?: string;
};

type MessageInput = {
  applicant_id: string;
  message_file?: string;
  message_id: string;
  receivedDateTime?: string;
  sender?: string;
  sender_name?: string;
  subject?: string;
  to?: string;
  cc?: string;
  body_content_type?: string;
  raw_email_text?: string;
  raw_truncated?: boolean;
  has_attachments?: boolean;
  web_link?: string;
};

const databaseUrl = process.env.DATABASE_URL;
const applicantJson = process.env.APPLICANT_JSON;
const rawEmailJson = process.env.RAW_EMAIL_JSON;
const sourceRoot = process.env.SOURCE_ROOT;
if (!databaseUrl || !applicantJson || !rawEmailJson || !sourceRoot) {
  throw new Error('DATABASE_URL, APPLICANT_JSON, RAW_EMAIL_JSON, and SOURCE_ROOT are required.');
}

const db = drizzle(neon(databaseUrl), { schema });
const applicantsPayload = JSON.parse(await readFile(resolve(applicantJson), 'utf8')) as {
  applicants: ApplicantInput[];
};
const messagesPayload = JSON.parse(await readFile(resolve(rawEmailJson), 'utf8')) as MessageInput[];
const applicants = applicantsPayload.applicants ?? [];

function numberOrNull(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : String(value);
}

function splitSkills(value: string | undefined): string[] {
  return (value ?? '')
    .split('/')
    .map((skill) => skill.trim())
    .filter(Boolean);
}

function splitRoles(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((role) => role.trim())
    .filter(Boolean);
}

function statusFor(
  value: string | undefined
): (typeof schema.internalApplicantStatusEnum.enumValues)[number] {
  if (value?.toLowerCase().includes('interview')) return 'interview';
  if (value?.toLowerCase().includes('assessment')) return 'assessment';
  if (value?.toLowerCase().includes('follow')) return 'screening';
  return 'new';
}

function scoreApplicant(
  applicant: ApplicantInput,
  skills: string[],
  university: string
): {
  skillsScore: string;
  educationScore: string;
  cultureScore: string;
  overallScore: string;
  recommendation: string;
} {
  const skillScore = Math.min(
    100,
    (applicant.skill_count ?? skills.length) * 8 + (applicant.project_evidence_count ?? 0) * 4
  );
  const educationScore = Math.min(
    100,
    (applicant.gpa == null ? 0 : (Math.min(applicant.gpa, 4) / 4) * 60) +
      (applicant.graduation_year ? 20 : 0) +
      (university ? 20 : 0)
  );
  const cultureScore = Math.max(
    0,
    Math.min(
      100,
      (applicant.culture_evidence_count ?? 0) * 15 +
        (applicant.project_evidence_count ?? 0) * 5 +
        (applicant.completeness_count ?? 0) * 2 +
        (applicant.school_outside_dhaka ? -5 : 0)
    )
  );
  const overallScore = skillScore * 0.5 + educationScore * 0.3 + cultureScore * 0.2;
  return {
    skillsScore: skillScore.toFixed(2),
    educationScore: educationScore.toFixed(2),
    cultureScore: cultureScore.toFixed(2),
    overallScore: overallScore.toFixed(2),
    recommendation:
      overallScore >= 75 ? 'High priority' : overallScore >= 55 ? 'Review' : 'Hold / incomplete',
  };
}

const rows = applicants.map((applicant) => {
  const skills = splitSkills(applicant.skills);
  const university = applicant.university?.trim() ?? '';
  const score = scoreApplicant(applicant, skills, university);
  return {
    workspaceId: schema.DEFAULT_WORKSPACE_ID,
    applicantNumber: applicant.applicant_id,
    fullName: applicant.name.trim() || applicant.email,
    email: applicant.email.trim().toLowerCase(),
    phone: applicant.phone?.trim() || null,
    rolesApplied: splitRoles(applicant.role_applied),
    source: 'outlook',
    status: statusFor(applicant.status),
    firstReceivedAt: applicant.first_received ? new Date(applicant.first_received) : null,
    lastReceivedAt: applicant.last_received ? new Date(applicant.last_received) : null,
    messageCount: applicant.message_count ?? 0,
    university: university || null,
    school: applicant.school?.trim() || null,
    educationLocation: applicant.education_location?.trim() || null,
    gpa: numberOrNull(applicant.gpa),
    graduationYear: applicant.graduation_year ?? null,
    skills,
    skillCount: applicant.skill_count ?? skills.length,
    cultureEvidenceCount: applicant.culture_evidence_count ?? 0,
    schoolOutsideDhaka: Boolean(applicant.school_outside_dhaka),
    locationProxyAdjustment: applicant.school_outside_dhaka ? -5 : 0,
    projectEvidenceCount: applicant.project_evidence_count ?? 0,
    completenessCount: applicant.completeness_count ?? 0,
    resumeCount: applicant.resume_files_final?.length ?? applicant.resume_names?.length ?? 0,
    skillsScore: score.skillsScore,
    educationScore: score.educationScore,
    cultureScore: score.cultureScore,
    overallScore: score.overallScore,
    recommendation: score.recommendation,
    scoreNotes:
      'Imported from the Outlook tracker; score is an editable screening aid, not a hiring decision.',
    rawEmailText: applicant.raw_email_text ?? null,
    rawTextTruncated: Boolean(applicant.raw_email_truncated),
    resumeText: applicant.resume_text ?? null,
    sourceMessageIds: applicant.source_message_ids ?? [],
  };
});

const insertedApplicants = rows.length
  ? await db
      .insert(schema.internalApplicants)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.internalApplicants.workspaceId, schema.internalApplicants.applicantNumber],
        set: {
          fullName: schema.internalApplicants.fullName,
          email: schema.internalApplicants.email,
          phone: schema.internalApplicants.phone,
          rolesApplied: schema.internalApplicants.rolesApplied,
          status: schema.internalApplicants.status,
          firstReceivedAt: schema.internalApplicants.firstReceivedAt,
          lastReceivedAt: schema.internalApplicants.lastReceivedAt,
          messageCount: schema.internalApplicants.messageCount,
          university: schema.internalApplicants.university,
          school: schema.internalApplicants.school,
          educationLocation: schema.internalApplicants.educationLocation,
          gpa: schema.internalApplicants.gpa,
          graduationYear: schema.internalApplicants.graduationYear,
          skills: schema.internalApplicants.skills,
          skillCount: schema.internalApplicants.skillCount,
          cultureEvidenceCount: schema.internalApplicants.cultureEvidenceCount,
          schoolOutsideDhaka: schema.internalApplicants.schoolOutsideDhaka,
          locationProxyAdjustment: schema.internalApplicants.locationProxyAdjustment,
          projectEvidenceCount: schema.internalApplicants.projectEvidenceCount,
          completenessCount: schema.internalApplicants.completenessCount,
          resumeCount: schema.internalApplicants.resumeCount,
          skillsScore: schema.internalApplicants.skillsScore,
          educationScore: schema.internalApplicants.educationScore,
          cultureScore: schema.internalApplicants.cultureScore,
          overallScore: schema.internalApplicants.overallScore,
          recommendation: schema.internalApplicants.recommendation,
          scoreNotes: schema.internalApplicants.scoreNotes,
          rawEmailText: schema.internalApplicants.rawEmailText,
          rawTextTruncated: schema.internalApplicants.rawTextTruncated,
          resumeText: schema.internalApplicants.resumeText,
          sourceMessageIds: schema.internalApplicants.sourceMessageIds,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: schema.internalApplicants.id,
        applicantNumber: schema.internalApplicants.applicantNumber,
      })
  : [];
const applicantIds = new Map(insertedApplicants.map((row) => [row.applicantNumber, row.id]));
const applicantByNumber = new Map(
  applicants.map((applicant) => [applicant.applicant_id, applicant])
);

const documentRows = [];
for (const applicant of applicants) {
  const applicantId = applicantIds.get(applicant.applicant_id);
  if (!applicantId) continue;
  const paths = applicant.resume_files_final ?? [];
  const names = applicant.resume_names ?? [];
  for (let index = 0; index < paths.length; index += 1) {
    const relativePath = paths[index];
    if (!relativePath) continue;
    const filePath = resolve(sourceRoot, relativePath);
    let fileSizeBytes: number | null = null;
    let sha256: string | null = null;
    try {
      const contents = await readFile(filePath);
      fileSizeBytes = contents.byteLength;
      sha256 = createHash('sha256').update(contents).digest('hex');
    } catch {
      // Keep metadata even when a source file is unavailable on a later rerun.
    }
    documentRows.push({
      workspaceId: schema.DEFAULT_WORKSPACE_ID,
      applicantId,
      documentType: 'resume' as const,
      fileName: names[index] || relativePath.split(/[\\/]/).pop() || `resume-${index + 1}`,
      mimeType: (names[index] || relativePath).toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/octet-stream',
      sourcePath: relativePath,
      sourceMessageId: applicant.source_message_ids?.[0] ?? null,
      extractedText: applicant.resume_text ?? null,
      fileSizeBytes,
      sha256,
      receivedAt: applicant.first_received ? new Date(applicant.first_received) : null,
    });
  }
}
if (documentRows.length) {
  await db
    .insert(schema.internalApplicantDocuments)
    .values(documentRows)
    .onConflictDoUpdate({
      target: [
        schema.internalApplicantDocuments.applicantId,
        schema.internalApplicantDocuments.sha256,
      ],
      set: {
        fileName: schema.internalApplicantDocuments.fileName,
        sourcePath: schema.internalApplicantDocuments.sourcePath,
        extractedText: schema.internalApplicantDocuments.extractedText,
        fileSizeBytes: schema.internalApplicantDocuments.fileSizeBytes,
        receivedAt: schema.internalApplicantDocuments.receivedAt,
        updatedAt: new Date(),
      },
    });
}

const messageRows = messagesPayload
  .map((message) => {
    const directApplicant = applicantByNumber.get(message.applicant_id);
    const haystack =
      `${message.subject ?? ''} ${message.raw_email_text ?? ''} ${message.sender_name ?? ''}`.toLowerCase();
    const inferredApplicant =
      directApplicant ??
      applicants.find((candidate) => {
        const email = candidate.email?.toLowerCase();
        const name = candidate.name?.toLowerCase();
        return Boolean(
          (email && haystack.includes(email)) ||
          (name && name.length > 4 && haystack.includes(name))
        );
      });
    const applicantId = applicantIds.get(inferredApplicant?.applicant_id ?? '');
    if (!applicantId || !message.message_id) return null;
    return {
      workspaceId: schema.DEFAULT_WORKSPACE_ID,
      applicantId,
      externalMessageId: message.message_id,
      messageFile: message.message_file ?? null,
      receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : null,
      sender: message.sender ?? null,
      senderName: message.sender_name ?? null,
      subject: message.subject ?? null,
      toRecipients: message.to ?? null,
      ccRecipients: message.cc ?? null,
      bodyContentType: message.body_content_type ?? null,
      rawEmailText: message.raw_email_text ?? null,
      rawTruncated: Boolean(message.raw_truncated),
      hasAttachments: Boolean(message.has_attachments),
      outlookLink: message.web_link ?? null,
    };
  })
  .filter((row): row is NonNullable<typeof row> => row !== null);
if (messageRows.length) {
  await db
    .insert(schema.internalApplicantMessages)
    .values(messageRows)
    .onConflictDoUpdate({
      target: schema.internalApplicantMessages.externalMessageId,
      set: {
        applicantId: schema.internalApplicantMessages.applicantId,
        receivedAt: schema.internalApplicantMessages.receivedAt,
        subject: schema.internalApplicantMessages.subject,
        rawEmailText: schema.internalApplicantMessages.rawEmailText,
        rawTruncated: schema.internalApplicantMessages.rawTruncated,
        hasAttachments: schema.internalApplicantMessages.hasAttachments,
        outlookLink: schema.internalApplicantMessages.outlookLink,
        updatedAt: new Date(),
      },
    });
}

const [applicantCount] = await db
  .select({ count: schema.internalApplicants.id })
  .from(schema.internalApplicants)
  .where(eq(schema.internalApplicants.workspaceId, schema.DEFAULT_WORKSPACE_ID));
const [documentCount] = await db
  .select({ count: schema.internalApplicantDocuments.id })
  .from(schema.internalApplicantDocuments)
  .where(eq(schema.internalApplicantDocuments.workspaceId, schema.DEFAULT_WORKSPACE_ID));
const [messageCount] = await db
  .select({ count: schema.internalApplicantMessages.id })
  .from(schema.internalApplicantMessages)
  .where(eq(schema.internalApplicantMessages.workspaceId, schema.DEFAULT_WORKSPACE_ID));
console.log(
  JSON.stringify({
    importedApplicants: rows.length,
    documents: documentRows.length,
    messages: messageRows.length,
    databaseRows: {
      applicants: applicantCount?.count ? 'present' : 'empty',
      documents: documentCount?.count ? 'present' : 'empty',
      messages: messageCount?.count ? 'present' : 'empty',
    },
  })
);
