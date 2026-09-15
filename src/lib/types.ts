export const statuses = [
  "To do",
  "In progress",
  "In review",
  "Completed",
] as const;
export const priorities = ["Low", "Medium", "High", "Urgent"] as const;
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
export type WorkspaceData = {
  user: User;
  team: User[];
  tasks: Task[];
  activity: Activity[];
  removalRequests?: RemovalRequest[];
};

