import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { Task, User } from "./types";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  fromEmail?: string;
}

export interface EmailLogEntry {
  id: string;
  to: string | string[];
  subject: string;
  replyTo?: string;
  from: string;
  provider: "smtp" | "resend" | "emailjs" | "simulated";
  status: "sent" | "simulated" | "failed";
  timestamp: string;
  error?: string;
}

const recentLogs: EmailLogEntry[] = [];

export function getRecentEmailLogs(limit = 20): EmailLogEntry[] {
  return recentLogs.slice(-limit).reverse();
}

export function getEmailServiceStatus() {
  const smtpUser = process.env.SMTP_USER?.trim() || process.env.HOSTINGER_EMAIL_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim() || process.env.HOSTINGER_EMAIL_PASS?.trim();
  const hasSmtp = Boolean(smtpUser && smtpPass && !smtpPass.includes("password_here"));
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim() && !process.env.RESEND_API_KEY.includes("your_api_key"));
  const hasEmailJS = Boolean(
    process.env.EMAILJS_SERVICE_ID?.trim() &&
      process.env.EMAILJS_TEMPLATE_ID?.trim() &&
      process.env.EMAILJS_PUBLIC_KEY?.trim(),
  );

  const provider: "smtp" | "resend" | "emailjs" | "simulated" = hasSmtp
    ? "smtp"
    : hasResend
      ? "resend"
      : hasEmailJS
        ? "emailjs"
        : "simulated";

  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    (hasSmtp ? `AutoNeural Workspace <${smtpUser}>` : "AutoNeural Workspace <notifications@autoneural.in>");

  return {
    provider,
    configured: hasSmtp || hasResend || hasEmailJS,
    fromEmail,
    hasSmtp,
    hasResendKey: hasResend,
    hasEmailJsKey: hasEmailJS,
  };
}

function getAppBaseUrl(): string {
  return (
    process.env.CRM_APP_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "https://work.autoneural.in"
      : "http://localhost:3000")
  ).replace(/\/+$/, "");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function emailWrapper({
  title,
  preheader,
  contentHtml,
  replyToNotice,
}: {
  title: string;
  preheader: string;
  contentHtml: string;
  replyToNotice?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #090a0f;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #090a0f;
      padding: 32px 16px;
      box-sizing: border-box;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background: #11131a;
      border: 1px solid #1e2230;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .header {
      padding: 24px 32px 20px;
      border-bottom: 1px solid #1e2230;
      background: linear-gradient(180deg, #151824 0%, #11131a 100%);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #ffffff;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-badge {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #6366f1;
      box-shadow: 0 0 12px #6366f1;
    }
    .body {
      padding: 32px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .badge-urgent { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-high { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-medium { background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); }
    .badge-low { background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .card {
      background: #151824;
      border: 1px solid #1e2230;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #1e2230;
      font-size: 14px;
    }
    .row:last-child {
      border-bottom: none;
    }
    .label {
      color: #94a3b8;
    }
    .value {
      color: #f1f5f9;
      font-weight: 500;
      text-align: right;
    }
    .button-container {
      text-align: center;
      margin: 28px 0 12px;
    }
    .button {
      display: inline-block;
      background: #6366f1;
      color: #ffffff !important;
      font-weight: 600;
      font-size: 14px;
      padding: 12px 28px;
      border-radius: 8px;
      text-decoration: none;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .footer {
      padding: 24px 32px;
      border-top: 1px solid #1e2230;
      background: #0d0f15;
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
      text-align: center;
    }
    .preheader {
      display: none;
      max-height: 0px;
      overflow: hidden;
      mso-hide: all;
    }
  </style>
</head>
<body>
  <div class="preheader">${preheader}</div>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="brand">
          <span class="brand-badge"></span>
          AutoNeural Workspace
        </div>
      </div>
      <div class="body">
        ${contentHtml}
      </div>
      <div class="footer">
        ${replyToNotice ? `<p style="margin: 0 0 8px; color: #94a3b8;">${replyToNotice}</p>` : ""}
        <p style="margin: 0;">AutoNeural CRM &bull; Notifications Engine</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  fromName,
  fromEmail,
}: SendEmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
  const status = getEmailServiceStatus();
  const recipients = Array.isArray(to) ? to : [to];
  const plainText = text || stripHtml(html);
  const logId = `mail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const effectiveReplyTo = replyTo || fromEmail;

  // Construct from address
  let fromAddress = status.fromEmail;
  if (fromEmail && (fromEmail.endsWith("@autoneural.in") || process.env.RESEND_DOMAIN_VERIFIED === "true")) {
    fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  } else if (fromName && !status.fromEmail.includes("<")) {
    fromAddress = `${fromName} <${status.fromEmail}>`;
  } else if (fromName && status.fromEmail.includes("<")) {
    fromAddress = `${fromName} ${status.fromEmail.slice(status.fromEmail.indexOf("<"))}`;
  }

  // 1. If SMTP (Hostinger Mail or any custom domain SMTP) configured
  if (status.provider === "smtp") {
    const smtpHost = process.env.SMTP_HOST?.trim() || "smtp.hostinger.com";
    const smtpPort = Number(process.env.SMTP_PORT?.trim() || 465);
    const smtpUser = (process.env.SMTP_USER || process.env.HOSTINGER_EMAIL_USER)!.trim();
    const smtpPass = (process.env.SMTP_PASS || process.env.HOSTINGER_EMAIL_PASS)!.trim();

    try {
      // Hostinger and strict SMTP servers require the FROM envelope address to match the authenticated SMTP user.
      // We ensure the email envelope matches smtpUser while the display name reflects the sender and replyTo directs replies.
      let smtpFrom = fromAddress;
      const smtpUserClean = smtpUser.toLowerCase();
      const match = fromAddress.match(/<([^>]+)>/);
      const fromEmailOnly = (match ? match[1] : fromAddress).trim().toLowerCase();

      if (fromEmailOnly !== smtpUserClean) {
        const senderName = fromName || (fromEmail ? fromEmail.split("@")[0] : "AutoNeural Workspace");
        smtpFrom = `"${senderName} via AutoNeural" <${smtpUser}>`;
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: recipients,
        subject,
        html,
        text: plainText,
        replyTo: effectiveReplyTo || fromEmail || smtpUser,
      });

      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo: effectiveReplyTo,
        from: fromAddress,
        provider: "smtp",
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      return { success: true, id: logId };
    } catch (err: any) {
      console.error("[EmailService:Hostinger SMTP Error]", err);
      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo: effectiveReplyTo,
        from: fromAddress,
        provider: "smtp",
        status: "failed",
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      });
      return { success: false, error: err?.message || "Failed to send email via Hostinger SMTP" };
    }
  }

  // 2. If Resend configured
  if (status.provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY.trim());
      let response = await resend.emails.send({
        from: fromAddress,
        to: recipients,
        subject,
        html,
        text: plainText,
        replyTo: effectiveReplyTo ? (Array.isArray(effectiveReplyTo) ? effectiveReplyTo : [effectiveReplyTo]) : undefined,
      });

      // Fallback if domain is unverified on Resend sandbox
      if (response.error && fromEmail && fromAddress !== status.fromEmail) {
        const fallbackFrom = fromName
          ? `${fromName} via AutoNeural <${status.fromEmail}>`
          : status.fromEmail;
        response = await resend.emails.send({
          from: fallbackFrom,
          to: recipients,
          subject,
          html,
          text: plainText,
          replyTo: [fromEmail],
        });
        if (!response.error) {
          fromAddress = fallbackFrom;
        }
      }

      if (response.error) {
        throw new Error(response.error.message);
      }

      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo: effectiveReplyTo,
        from: fromAddress,
        provider: "resend",
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      return { success: true, id: response.data?.id || logId };
    } catch (err: any) {
      console.error("[EmailService:Resend Error]", err);
      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo: effectiveReplyTo,
        from: fromAddress,
        provider: "resend",
        status: "failed",
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      });
      return { success: false, error: err?.message || "Failed to send email via Resend" };
    }
  }

  // 2. If EmailJS configured
  if (status.provider === "emailjs") {
    try {
      const payload = {
        service_id: process.env.EMAILJS_SERVICE_ID?.trim(),
        template_id: process.env.EMAILJS_TEMPLATE_ID?.trim(),
        user_id: process.env.EMAILJS_PUBLIC_KEY?.trim(),
        accessToken: process.env.EMAILJS_PRIVATE_KEY?.trim() || undefined,
        template_params: {
          to_email: recipients.join(", "),
          reply_to: replyTo || "",
          from_name: fromName || "AutoNeural Workspace",
          subject,
          message_html: html,
          message_text: plainText,
        },
      };

      const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`EmailJS API error: ${res.status} ${text}`);
      }

      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo,
        from: fromAddress,
        provider: "emailjs",
        status: "sent",
        timestamp: new Date().toISOString(),
      });

      return { success: true, id: logId };
    } catch (err: any) {
      console.error("[EmailService:EmailJS Error]", err);
      recentLogs.push({
        id: logId,
        to: recipients,
        subject,
        replyTo,
        from: fromAddress,
        provider: "emailjs",
        status: "failed",
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      });
      return { success: false, error: err?.message || "Failed to send email via EmailJS" };
    }
  }

  // 3. Fallback / Simulated mode for dev and tests
  console.log(
    `[EmailService:Simulated] To: ${recipients.join(", ")} | Reply-To: ${replyTo || "none"} | Subject: "${subject}"`,
  );
  recentLogs.push({
    id: logId,
    to: recipients,
    subject,
    replyTo,
    from: fromAddress,
    provider: "simulated",
    status: "simulated",
    timestamp: new Date().toISOString(),
  });

  return { success: true, id: logId };
}

// ---------------------------------------------------------------------------
// Template Generators
// ---------------------------------------------------------------------------

export function renderTaskAssignedEmail({
  task,
  employee,
  admin,
  appUrl,
}: {
  task: Pick<Task, "id" | "title" | "description" | "priority" | "dueDate" | "project">;
  employee: Pick<User, "name" | "email">;
  admin: Pick<User, "name" | "email">;
  appUrl: string;
}): { html: string; text: string; subject: string } {
  const taskLink = `${appUrl}?task=${encodeURIComponent(task.id)}`;
  const priorityClass =
    task.priority === "Urgent"
      ? "badge-urgent"
      : task.priority === "High"
        ? "badge-high"
        : task.priority === "Medium"
          ? "badge-medium"
          : "badge-low";

  const subject = `[AutoNeural Workspace] New Task Assigned: ${task.title}`;
  const preheader = `${admin.name} assigned you a new task: ${task.title}`;

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 8px;">
        New Task Assigned
      </h1>
      <p style="font-size: 15px; color: #94a3b8; margin: 0; line-height: 1.5;">
        Hello <strong style="color: #f1f5f9;">${employee.name}</strong>, you have been assigned a new task by <strong style="color: #f1f5f9;">${admin.name}</strong> (${admin.email}).
      </p>
    </div>

    <div class="card">
      <div class="row">
        <span class="label">Task</span>
        <span class="value" style="font-size: 15px; font-weight: 600;">${task.title}</span>
      </div>
      <div class="row">
        <span class="label">Project</span>
        <span class="value">${task.project || "General Workspace"}</span>
      </div>
      <div class="row">
        <span class="label">Priority</span>
        <span class="value">
          <span class="badge ${priorityClass}">${task.priority}</span>
        </span>
      </div>
      <div class="row">
        <span class="label">Due Date</span>
        <span class="value" style="color: #fbbf24; font-weight: 600;">${task.dueDate}</span>
      </div>
      ${
        task.description
          ? `
        <div style="padding-top: 14px; margin-top: 6px; border-top: 1px solid #1e2230;">
          <span class="label" style="display: block; margin-bottom: 6px;">Description</span>
          <p style="margin: 0; font-size: 13px; color: #cbd5e1; line-height: 1.6; white-space: pre-line;">
            ${task.description}
          </p>
        </div>`
          : ""
      }
    </div>

    <div class="button-container">
      <a href="${taskLink}" class="button" target="_blank">
        View Task in Workspace &rarr;
      </a>
    </div>
  `;

  const html = emailWrapper({
    title: subject,
    preheader,
    contentHtml,
    replyToNotice: `Replying to this email will respond directly to ${admin.name} (${admin.email}).`,
  });

  const text = `
New Task Assigned: ${task.title}

Hello ${employee.name},
${admin.name} (${admin.email}) has assigned you a new task in AutoNeural Workspace.

Task Details:
- Title: ${task.title}
- Project: ${task.project || "General Workspace"}
- Priority: ${task.priority}
- Due Date: ${task.dueDate}
${task.description ? `\nDescription:\n${task.description}\n` : ""}

View Task: ${taskLink}

Reply directly to this email to contact ${admin.name}.
  `.trim();

  return { html, text, subject };
}

export function renderTaskCompletedEmail({
  task,
  employee,
  admin,
  appUrl,
}: {
  task: Pick<Task, "id" | "title" | "project" | "completedAt">;
  employee: Pick<User, "name" | "email">;
  admin: Pick<User, "name" | "email">;
  appUrl: string;
}): { html: string; text: string; subject: string } {
  const taskLink = `${appUrl}?task=${encodeURIComponent(task.id)}`;
  const subject = `[AutoNeural Workspace] Task Completed: ${task.title}`;
  const preheader = `${employee.name} marked "${task.title}" as Completed`;

  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <div style="margin-bottom: 12px;">
        <span class="badge badge-success">✓ Completed</span>
      </div>
      <h1 style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 8px;">
        Task Completed
      </h1>
      <p style="font-size: 15px; color: #94a3b8; margin: 0; line-height: 1.5;">
        Hello <strong style="color: #f1f5f9;">${admin.name}</strong>,
        <strong style="color: #f1f5f9;">${employee.name}</strong> (${employee.email}) has marked the following task as <strong>Completed</strong>.
      </p>
    </div>

    <div class="card">
      <div class="row">
        <span class="label">Task</span>
        <span class="value" style="font-size: 15px; font-weight: 600;">${task.title}</span>
      </div>
      <div class="row">
        <span class="label">Project</span>
        <span class="value">${task.project || "General Workspace"}</span>
      </div>
      <div class="row">
        <span class="label">Completed By</span>
        <span class="value">${employee.name}</span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="value" style="color: #34d399; font-weight: 600;">Completed</span>
      </div>
    </div>

    <div class="button-container">
      <a href="${taskLink}" class="button" target="_blank">
        Review Completed Task &rarr;
      </a>
    </div>
  `;

  const html = emailWrapper({
    title: subject,
    preheader,
    contentHtml,
    replyToNotice: `Replying to this email will respond directly to ${employee.name} (${employee.email}).`,
  });

  const text = `
Task Completed: ${task.title}

Hello ${admin.name},
${employee.name} (${employee.email}) has marked the following task as Completed:

- Task: ${task.title}
- Project: ${task.project || "General Workspace"}
- Completed By: ${employee.name}

Review Task: ${taskLink}

Reply directly to this email to contact ${employee.name}.
  `.trim();

  return { html, text, subject };
}

export function renderTaskCommentEmail({
  task,
  author,
  commentText,
  recipient,
  appUrl,
}: {
  task: Pick<Task, "id" | "title" | "project">;
  author: Pick<User, "name" | "email">;
  commentText: string;
  recipient: Pick<User, "name" | "email">;
  appUrl: string;
}): { html: string; text: string; subject: string } {
  const taskLink = `${appUrl}?task=${encodeURIComponent(task.id)}`;
  const subject = `[AutoNeural Workspace] New comment on "${task.title}" by ${author.name}`;
  const preheader = `${author.name} commented: "${commentText.slice(0, 80)}..."`;

  const contentHtml = `
    <div style="margin-bottom: 20px;">
      <h1 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 8px;">
        New Comment on Task
      </h1>
      <p style="font-size: 14px; color: #94a3b8; margin: 0; line-height: 1.5;">
        Hello <strong style="color: #f1f5f9;">${recipient.name}</strong>,
        <strong style="color: #f1f5f9;">${author.name}</strong> (${author.email}) posted a comment on <strong style="color: #f1f5f9;">${task.title}</strong>:
      </p>
    </div>

    <div class="card" style="border-left: 3px solid #6366f1; background: #131622;">
      <div style="font-size: 14px; color: #e2e8f0; line-height: 1.6; white-space: pre-line; font-style: italic;">
        "${commentText}"
      </div>
      <div style="margin-top: 12px; font-size: 12px; color: #64748b; text-align: right;">
        &mdash; ${author.name}
      </div>
    </div>

    <div class="button-container">
      <a href="${taskLink}" class="button" target="_blank">
        View Comment &amp; Reply &rarr;
      </a>
    </div>
  `;

  const html = emailWrapper({
    title: subject,
    preheader,
    contentHtml,
    replyToNotice: `Replying to this email will respond directly to ${author.name} (${author.email}).`,
  });

  const text = `
New Comment on Task: ${task.title}

Hello ${recipient.name},
${author.name} (${author.email}) commented on "${task.title}":

"${commentText}"

View & Reply: ${taskLink}

Reply directly to this email to contact ${author.name}.
  `.trim();

  return { html, text, subject };
}

// ---------------------------------------------------------------------------
// High-level automated trigger dispatchers
// ---------------------------------------------------------------------------

export async function notifyTaskAssigned(
  task: Pick<Task, "id" | "title" | "description" | "priority" | "dueDate" | "project">,
  employee: Pick<User, "name" | "email">,
  admin: Pick<User, "name" | "email">,
) {
  try {
    const appUrl = getAppBaseUrl();
    const { html, text, subject } = renderTaskAssignedEmail({
      task,
      employee,
      admin,
      appUrl,
    });

    return await sendEmail({
      to: employee.email,
      subject,
      html,
      text,
      replyTo: admin.email,
      fromName: "AutoNeural Workspace",
    });
  } catch (err) {
    console.error("[notifyTaskAssigned Error]", err);
    return { success: false, error: String(err) };
  }
}

export async function notifyTaskCompleted(
  task: Pick<Task, "id" | "title" | "project" | "completedAt">,
  employee: Pick<User, "name" | "email">,
  admin: Pick<User, "name" | "email">,
) {
  try {
    const appUrl = getAppBaseUrl();
    const { html, text, subject } = renderTaskCompletedEmail({
      task,
      employee,
      admin,
      appUrl,
    });

    return await sendEmail({
      to: admin.email,
      subject,
      html,
      text,
      replyTo: employee.email,
      fromName: `${employee.name} via AutoNeural`,
    });
  } catch (err) {
    console.error("[notifyTaskCompleted Error]", err);
    return { success: false, error: String(err) };
  }
}

export async function notifyTaskComment(
  task: Pick<Task, "id" | "title" | "project">,
  author: Pick<User, "name" | "email">,
  commentText: string,
  recipient: Pick<User, "name" | "email">,
) {
  try {
    const appUrl = getAppBaseUrl();
    const { html, text, subject } = renderTaskCommentEmail({
      task,
      author,
      commentText,
      recipient,
      appUrl,
    });

    return await sendEmail({
      to: recipient.email,
      subject,
      html,
      text,
      replyTo: author.email,
      fromName: `${author.name} via AutoNeural`,
    });
  } catch (err) {
    console.error("[notifyTaskComment Error]", err);
    return { success: false, error: String(err) };
  }
}

export async function sendTestEmail(targetEmail: string) {
  const appUrl = getAppBaseUrl();
  const subject = "[AutoNeural Workspace] Email Notification Test";
  const contentHtml = `
    <h1 style="font-size: 22px; font-weight: 700; color: #ffffff; margin: 0 0 12px;">
      Email Delivery Verified ✓
    </h1>
    <p style="font-size: 15px; color: #cbd5e1; line-height: 1.6; margin: 0 0 16px;">
      This is a test notification from your AutoNeural Workspace. If you are reading this email, your email provider integration is functioning properly.
    </p>
    <div class="card">
      <div class="row">
        <span class="label">Provider</span>
        <span class="value">${getEmailServiceStatus().provider.toUpperCase()}</span>
      </div>
      <div class="row">
        <span class="label">Sender</span>
        <span class="value">${getEmailServiceStatus().fromEmail}</span>
      </div>
      <div class="row">
        <span class="label">Workspace URL</span>
        <span class="value">${appUrl}</span>
      </div>
    </div>
  `;

  const html = emailWrapper({
    title: subject,
    preheader: "Your AutoNeural email integration is active and working.",
    contentHtml,
  });

  return await sendEmail({
    to: targetEmail,
    subject,
    html,
    text: "AutoNeural Workspace test notification. Your email provider integration is functioning properly.",
  });
}

export function renderDirectEmail({
  sender,
  subject,
  message,
  taskLink,
  taskTitle,
}: {
  sender: Pick<User, "name" | "email" | "designation">;
  subject: string;
  message: string;
  taskLink?: string;
  taskTitle?: string;
}): { html: string; text: string; subject: string } {
  const contentHtml = `
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 20px; font-weight: 700; color: #ffffff; margin: 0 0 8px;">
        ${subject}
      </h1>
      <p style="font-size: 13px; color: #94a3b8; margin: 0;">
        From <strong style="color: #f1f5f9;">${sender.name}</strong> (${sender.email})
        ${sender.designation ? ` &bull; ${sender.designation}` : ""}
      </p>
    </div>

    <div class="card" style="background: #141722; border: 1px solid #1e2230; padding: 24px; font-size: 14px; line-height: 1.7; color: #f1f5f9; white-space: pre-line;">
${message}
    </div>

    ${
      taskLink && taskTitle
        ? `
      <div style="background: #10131d; border: 1px solid #1e2230; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
        <span style="font-size: 12px; color: #94a3b8; display: block; margin-bottom: 8px;">Referenced Task: <strong>${taskTitle}</strong></span>
        <a href="${taskLink}" class="button" target="_blank" style="display: inline-block; font-size: 13px; padding: 8px 20px;">
          Open Task in Workspace &rarr;
        </a>
      </div>`
        : ""
    }

    <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid #1e2230; font-size: 13px; color: #94a3b8;">
      <p style="margin: 0 0 4px; font-weight: 600; color: #f1f5f9;">${sender.name}</p>
      <p style="margin: 0; color: #64748b; font-size: 12px;">${sender.designation || "AutoNeural Team"} &bull; <a href="mailto:${sender.email}" style="color: #818cf8; text-decoration: none;">${sender.email}</a></p>
    </div>
  `;

  const html = emailWrapper({
    title: subject,
    preheader: message.slice(0, 100),
    contentHtml,
    replyToNotice: `You can reply directly to this email to reach ${sender.name} (${sender.email}).`,
  });

  const text = `
${subject}

From: ${sender.name} (${sender.email})
${sender.designation ? `Title: ${sender.designation}\n` : ""}
------------------------------------------------------------
${message}
------------------------------------------------------------
${taskLink ? `Referenced Task (${taskTitle || "Task"}): ${taskLink}\n` : ""}
Reply directly to this email to contact ${sender.name} at ${sender.email}.
  `.trim();

  return { html, text, subject };
}
