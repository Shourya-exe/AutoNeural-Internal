import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as nodemailer from 'nodemailer';

export interface SendEmailDto {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  fromEmail?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resendClient: Resend | null = null;
  private smtpTransporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const smtpUser = this.configService.get<string>('SMTP_USER')?.trim() || this.configService.get<string>('HOSTINGER_EMAIL_USER')?.trim();
    const smtpPass = this.configService.get<string>('SMTP_PASS')?.trim() || this.configService.get<string>('HOSTINGER_EMAIL_PASS')?.trim();
    if (smtpUser && smtpPass && !smtpPass.includes('password_here')) {
      const host = this.configService.get<string>('SMTP_HOST')?.trim() || 'smtp.hostinger.com';
      const port = Number(this.configService.get<string>('SMTP_PORT')?.trim() || 465);
      this.smtpTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      this.logger.log(`[EmailService] Initialized SMTP transporter with host: ${host}:${port}`);
    }

    const resendKey = this.configService.get<string>('RESEND_API_KEY')?.trim();
    if (resendKey && !resendKey.includes('your_api_key')) {
      this.resendClient = new Resend(resendKey);
    }
  }

  private getFromEmail(): string {
    const customSmtp = this.configService.get<string>('SMTP_FROM_EMAIL')?.trim();
    if (customSmtp) return customSmtp;
    const custom = this.configService.get<string>('RESEND_FROM_EMAIL')?.trim();
    if (custom) return custom;
    const smtpUser = this.configService.get<string>('SMTP_USER')?.trim() || this.configService.get<string>('HOSTINGER_EMAIL_USER')?.trim();
    if (smtpUser) return `AutoNeural Workspace <${smtpUser}>`;
    if (this.resendClient) {
      return 'AutoNeural Workspace <onboarding@resend.dev>';
    }
    return 'AutoNeural Workspace <notifications@autoneural.in>';
  }

  private getAppUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ||
      'https://work.autoneural.in'
    ).replace(/\/+$/, '');
  }

  async sendEmail(dto: SendEmailDto): Promise<{ success: boolean; id?: string; error?: string }> {
    const recipients = Array.isArray(dto.to) ? dto.to : [dto.to];
    const defaultFrom = this.getFromEmail();
    let fromAddress = defaultFrom;

    if (dto.fromName && !defaultFrom.includes('<')) {
      fromAddress = `${dto.fromName} <${defaultFrom}>`;
    } else if (dto.fromName && defaultFrom.includes('<')) {
      fromAddress = `${dto.fromName} ${defaultFrom.slice(defaultFrom.indexOf('<'))}`;
    }

    // 1. SMTP (Hostinger / Custom)
    if (this.smtpTransporter) {
      try {
        const smtpUser = (this.configService.get<string>('SMTP_USER') || this.configService.get<string>('HOSTINGER_EMAIL_USER') || '').trim();
        let smtpFrom = fromAddress;
        if (smtpUser) {
          const match = fromAddress.match(/<([^>]+)>/);
          const fromEmailOnly = (match ? match[1] : fromAddress).trim().toLowerCase();
          if (fromEmailOnly !== smtpUser.toLowerCase()) {
            const senderName = dto.fromName || (dto.fromEmail ? dto.fromEmail.split('@')[0] : 'AutoNeural Workspace');
            smtpFrom = `"${senderName} via AutoNeural" <${smtpUser}>`;
          }
        }

        const info = await this.smtpTransporter.sendMail({
          from: smtpFrom,
          to: recipients,
          subject: dto.subject,
          html: dto.html,
          text: dto.text,
          replyTo: dto.replyTo || dto.fromEmail || (smtpUser || undefined),
        });
        this.logger.log(`[SMTP] Sent email to ${recipients.join(', ')}: "${dto.subject}"`);
        return { success: true, id: info.messageId };
      } catch (err: any) {
        this.logger.error(`[SMTP Error] ${err?.message || err}`);
        return { success: false, error: err?.message || 'Failed to send email via SMTP' };
      }
    }

    // 2. Resend
    if (this.resendClient) {
      try {
        const result = await this.resendClient.emails.send({
          from: fromAddress,
          to: recipients,
          subject: dto.subject,
          html: dto.html,
          text: dto.text,
          replyTo: dto.replyTo,
        });

        if (result.error) {
          throw new Error(result.error.message);
        }

        this.logger.log(`[Resend] Sent email to ${recipients.join(', ')}: "${dto.subject}"`);
        return { success: true, id: result.data?.id };
      } catch (err: any) {
        this.logger.error(`[Resend Error] ${err?.message || err}`);
        return { success: false, error: err?.message || 'Failed to send email via Resend' };
      }
    }

    // 2. EmailJS
    const emailJsService = this.configService.get<string>('EMAILJS_SERVICE_ID');
    const emailJsTemplate = this.configService.get<string>('EMAILJS_TEMPLATE_ID');
    const emailJsUser = this.configService.get<string>('EMAILJS_PUBLIC_KEY');
    if (emailJsService && emailJsTemplate && emailJsUser) {
      try {
        const payload = {
          service_id: emailJsService,
          template_id: emailJsTemplate,
          user_id: emailJsUser,
          accessToken: this.configService.get<string>('EMAILJS_PRIVATE_KEY'),
          template_params: {
            to_email: recipients.join(', '),
            reply_to: dto.replyTo || '',
            from_name: dto.fromName || 'AutoNeural Workspace',
            subject: dto.subject,
            message_html: dto.html,
            message_text: dto.text,
          },
        };

        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`EmailJS API error: ${res.status} ${text}`);
        }

        this.logger.log(`[EmailJS] Sent email to ${recipients.join(', ')}: "${dto.subject}"`);
        return { success: true };
      } catch (err: any) {
        this.logger.error(`[EmailJS Error] ${err?.message || err}`);
        return { success: false, error: err?.message || 'Failed to send email via EmailJS' };
      }
    }

    // 3. Fallback / Simulation
    this.logger.log(
      `[Simulated Email] To: ${recipients.join(', ')} | Reply-To: ${dto.replyTo || 'none'} | Subject: "${dto.subject}"`,
    );
    return { success: true, id: `sim-${Date.now()}` };
  }

  async notifyTaskAssigned(params: {
    taskId: string;
    taskTitle: string;
    priority: string;
    dueDate?: string | null;
    project?: string | null;
    description?: string;
    employeeName: string;
    employeeEmail: string;
    adminName: string;
    adminEmail: string;
  }) {
    try {
      const appUrl = this.getAppUrl();
      const taskLink = `${appUrl}?task=${encodeURIComponent(params.taskId)}`;
      const subject = `[AutoNeural Workspace] New Task Assigned: ${params.taskTitle}`;

      const html = `
        <div style="font-family: sans-serif; background: #090a0f; color: #e2e8f0; padding: 24px;">
          <div style="max-width: 560px; margin: 0 auto; background: #11131a; border: 1px solid #1e2230; border-radius: 8px; padding: 24px;">
            <h2 style="color: #fff; margin-top: 0;">New Task Assigned</h2>
            <p>Hello <strong>${params.employeeName}</strong>,</p>
            <p><strong>${params.adminName}</strong> (${params.adminEmail}) assigned you a new task:</p>
            <div style="background: #151824; border: 1px solid #1e2230; border-radius: 6px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Task:</strong> ${params.taskTitle}</p>
              <p style="margin: 4px 0;"><strong>Project:</strong> ${params.project || 'General'}</p>
              <p style="margin: 4px 0;"><strong>Priority:</strong> ${params.priority}</p>
              ${params.dueDate ? `<p style="margin: 4px 0;"><strong>Due Date:</strong> ${params.dueDate}</p>` : ''}
              ${params.description ? `<p style="margin: 8px 0 0; color: #94a3b8;">${params.description}</p>` : ''}
            </div>
            <div style="text-align: center; margin-top: 24px;">
              <a href="${taskLink}" style="background: #6366f1; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Task in Workspace</a>
            </div>
            <p style="font-size: 11px; color: #64748b; margin-top: 24px; text-align: center;">Replying to this email will respond directly to ${params.adminName} (${params.adminEmail}).</p>
          </div>
        </div>
      `;

      return await this.sendEmail({
        to: params.employeeEmail,
        subject,
        html,
        text: `New task assigned: ${params.taskTitle} by ${params.adminName}. View: ${taskLink}`,
        replyTo: params.adminEmail,
        fromName: 'AutoNeural Workspace',
      });
    } catch (err) {
      this.logger.error(`Failed to notify task assignment: ${err}`);
      return { success: false, error: String(err) };
    }
  }

  async notifyTaskCompleted(params: {
    taskId: string;
    taskTitle: string;
    project?: string | null;
    employeeName: string;
    employeeEmail: string;
    adminEmail: string;
    adminName: string;
  }) {
    try {
      const appUrl = this.getAppUrl();
      const taskLink = `${appUrl}?task=${encodeURIComponent(params.taskId)}`;
      const subject = `[AutoNeural Workspace] Task Completed: ${params.taskTitle}`;

      const html = `
        <div style="font-family: sans-serif; background: #090a0f; color: #e2e8f0; padding: 24px;">
          <div style="max-width: 560px; margin: 0 auto; background: #11131a; border: 1px solid #1e2230; border-radius: 8px; padding: 24px;">
            <div style="display: inline-block; background: rgba(16,185,129,0.2); color: #34d399; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">✓ COMPLETED</div>
            <h2 style="color: #fff; margin-top: 12px;">Task Completed</h2>
            <p>Hello <strong>${params.adminName}</strong>,</p>
            <p><strong>${params.employeeName}</strong> (${params.employeeEmail}) marked the task as <strong>Completed</strong>:</p>
            <div style="background: #151824; border: 1px solid #1e2230; border-radius: 6px; padding: 16px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Task:</strong> ${params.taskTitle}</p>
              <p style="margin: 4px 0;"><strong>Project:</strong> ${params.project || 'General'}</p>
              <p style="margin: 4px 0;"><strong>Completed by:</strong> ${params.employeeName}</p>
            </div>
            <div style="text-align: center; margin-top: 24px;">
              <a href="${taskLink}" style="background: #6366f1; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">Review Completed Task</a>
            </div>
            <p style="font-size: 11px; color: #64748b; margin-top: 24px; text-align: center;">Replying to this email will respond directly to ${params.employeeName} (${params.employeeEmail}).</p>
          </div>
        </div>
      `;

      return await this.sendEmail({
        to: params.adminEmail,
        subject,
        html,
        text: `Task completed: ${params.taskTitle} by ${params.employeeName}. Review: ${taskLink}`,
        replyTo: params.employeeEmail,
        fromName: `${params.employeeName} via AutoNeural`,
      });
    } catch (err) {
      this.logger.error(`Failed to notify task completion: ${err}`);
      return { success: false, error: String(err) };
    }
  }

  async notifyCommentAdded(params: {
    taskId: string;
    taskTitle: string;
    authorName: string;
    authorEmail: string;
    commentText: string;
    recipientEmail: string;
    recipientName: string;
  }) {
    try {
      const appUrl = this.getAppUrl();
      const taskLink = `${appUrl}?task=${encodeURIComponent(params.taskId)}`;
      const subject = `[AutoNeural Workspace] New comment on "${params.taskTitle}" by ${params.authorName}`;

      const html = `
        <div style="font-family: sans-serif; background: #090a0f; color: #e2e8f0; padding: 24px;">
          <div style="max-width: 560px; margin: 0 auto; background: #11131a; border: 1px solid #1e2230; border-radius: 8px; padding: 24px;">
            <h2 style="color: #fff; margin-top: 0;">New Comment on Task</h2>
            <p>Hello <strong>${params.recipientName}</strong>,</p>
            <p><strong>${params.authorName}</strong> (${params.authorEmail}) left a comment on <strong>${params.taskTitle}</strong>:</p>
            <div style="background: #151824; border-left: 3px solid #6366f1; border-radius: 4px; padding: 16px; margin: 16px 0; font-style: italic;">
              "${params.commentText}"
            </div>
            <div style="text-align: center; margin-top: 24px;">
              <a href="${taskLink}" style="background: #6366f1; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Comment & Reply</a>
            </div>
            <p style="font-size: 11px; color: #64748b; margin-top: 24px; text-align: center;">Replying to this email will respond directly to ${params.authorName} (${params.authorEmail}).</p>
          </div>
        </div>
      `;

      return await this.sendEmail({
        to: params.recipientEmail,
        subject,
        html,
        text: `New comment on "${params.taskTitle}" by ${params.authorName}: "${params.commentText}". Link: ${taskLink}`,
        replyTo: params.authorEmail,
        fromName: `${params.authorName} via AutoNeural`,
      });
    } catch (err) {
      this.logger.error(`Failed to notify comment: ${err}`);
      return { success: false, error: String(err) };
    }
  }
}
