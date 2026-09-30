export const statuses = [
  "To do",
  "In progress",
  "In review",
  "Completed",
] as const;
/** The one master admin: always active, always admin, cannot be removed, demoted or reset by other admins. */
export const MASTER_ADMIN_EMAIL = "info@autoneural.in";
export const isMasterAdmin = (u: { email: string } | null | undefined) =>
  u?.email.toLowerCase() === MASTER_ADMIN_EMAIL;
export const priorities = ["Low", "Medium", "High", "Urgent"] as const;
/** File types accepted for task attachments: extension → content type served on download. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
};
/** For <input type="file" accept>. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).map((e) => `.${e}`).join(",");
export type Status = (typeof statuses)[number];
export type Priority = (typeof priorities)[number];
export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  mustChange: boolean;
  designation?: string;
  status?: "ACTIVE" | "INACTIVE";
};
export type TaskAttachment = {
  id: string;
  taskId: string;
  name: string;
  type: "FILE" | "DOCUMENT" | "LINK";
  /** Links: the external URL. Files: /api/attachments/<id>; "#" for files recorded before uploads were stored. */
  url: string;
  fileSize?: number;
  purpose: "REFERENCE" | "OUTPUT" | "FOR_APPROVAL";
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED" | null;
  reviewNote?: string | null;
  uploaderId: string;
  uploaderName: string;
  createdAt: string;
};
export type Task = {
  id: string;
  number: number;
  title: string;
  description: string;
  assigneeId: string;
  createdBy: string;
  status: Status;
  priority: Priority;
  dueDate: string;
  project: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
  commentCount: number;
  attachmentCount?: number;
  attachments?: TaskAttachment[];
};
export type Activity = {
  id: string;
  taskId: string;
  actorName: string;
  text: string;
  createdAt: string;
};
export type Comment = Activity;
export type RemovalRequest = {
  id: string;
  employeeId: string;
  requestedById: string;
  requestedByName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string | null;
  createdAt: string;
};
/** A password reset someone asked for on the sign-in page, waiting for an admin. */
export type PasswordResetRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "employee";
  requestedAt: string;
  ip: string | null;
  /** False when only the master admin may approve it. */
  canApprove: boolean;
};
export type AuthLog = {
  id: string;
  userId?: string | null;
  name: string;
  email: string;
  role: string;
  action: "LOGIN" | "LOGOUT";
  ip?: string | null;
  userAgent?: string | null;
  timestamp: string;
};
export type EmailMessage = {
  id: string;
  threadId: string;
  senderId?: string | null;
  senderName: string;
  senderEmail: string;
  recipientId?: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  status: "unread" | "read";
  direction: "INBOUND" | "OUTBOUND";
  replyTo?: string | null;
  inReplyTo?: string | null;
  snippet?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  createdAt: string;
  seenAt?: string | null;
};
export type WorkspaceData = {
  user: User;
  team: User[];
  tasks: Task[];
  activity: Activity[];
  removalRequests?: RemovalRequest[];
  passwordResets?: PasswordResetRequest[];
  authLogs?: AuthLog[];
  emails?: EmailMessage[];
  unreadEmailCount?: number;
  /** Largest task attachment the server accepts, in MB. */
  uploadLimitMb: number;
  emailStatus?: {
    provider: "smtp" | "resend" | "emailjs" | "simulated" | "none";
    configured: boolean;
    fromEmail: string;
  };
};

