import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  CrmActivityType,
  DealStatus,
  LeadStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult } from '../../common/dto/pagination-query.dto';
import {
  CompleteActivityDto,
  ContactFilterDto,
  CreateAccountDto,
  CreateContactDto,
  CreateDealDto,
  CreateStageDto,
  DealFilterDto,
  LogActivityDto,
  UpdateContactDto,
  UpdateDealDto,
} from './dto/crm.dto';

type Tx = Prisma.TransactionClient;

export const OPEN_LEAD_STATUSES: LeadStatus[] = [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED];
// Activities that count as actually reaching the lead (moves NEW -> CONTACTED).
const TOUCH_TYPES: CrmActivityType[] = [
  CrmActivityType.CALL,
  CrmActivityType.WHATSAPP,
  CrmActivityType.EMAIL,
  CrmActivityType.MEETING,
];
const DEFAULT_STAGES: [string, number][] = [
  ['New', 10],
  ['Qualified', 25],
  ['Proposal', 50],
  ['Negotiation', 75],
];
const person = { select: { id: true, name: true } };

// Canonical form so "+91 98765 43210", "098765 43210" and "9876543210" dedupe to one contact.
// ponytail: India-only rules; switch to libphonenumber when non-Indian numbers matter.
export function normalizePhone(p?: string | null) {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  if (!digits) return null;
  if (p.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return digits;
}

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant filter plus ownership: employees only see records they own. */
  private scope(u: AuthenticatedUser) {
    return u.role === Role.ADMIN
      ? { organizationId: u.organizationId }
      : { organizationId: u.organizationId, ownerId: u.id };
  }

  private async resolveOwner(u: AuthenticatedUser, ownerId?: string) {
    if (!ownerId || ownerId === u.id) return u.id;
    if (u.role !== Role.ADMIN) throw new ForbiddenException('Only admins can assign records to other users');
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, organizationId: u.organizationId, status: AccountStatus.ACTIVE },
    });
    if (!owner) throw new BadRequestException('Owner must be an active user in your organization');
    return owner.id;
  }

  private async assertAccount(u: AuthenticatedUser, accountId?: string | null) {
    if (!accountId) return;
    const found = await this.prisma.account.findFirst({ where: { id: accountId, organizationId: u.organizationId } });
    if (!found) throw new BadRequestException('Account not found');
  }

  private system(tx: Tx, u: AuthenticatedUser, contactId: string, subject: string, dealId?: string) {
    return tx.crmActivity.create({
      data: {
        organizationId: u.organizationId,
        contactId,
        dealId,
        createdById: u.id,
        ownerId: u.id,
        type: CrmActivityType.SYSTEM,
        subject,
        completedAt: new Date(),
      },
    });
  }

  private page(q: { page?: number; limit?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    return { page, limit, skip: (page - 1) * limit };
  }

  private paginated<T>(data: T[], total: number, page: number, limit: number): PaginatedResult<T> {
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: { total, page, limit, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
    };
  }

  // ─── Accounts ──────────────────────────────────────────────────────────────

  createAccount(u: AuthenticatedUser, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        organizationId: u.organizationId,
        ownerId: u.id,
        name: dto.name.trim(),
        gstin: dto.gstin?.trim().toUpperCase() || null,
        industry: dto.industry?.trim() || null,
      },
    });
  }

  listAccounts(u: AuthenticatedUser, search?: string) {
    return this.prisma.account.findMany({
      where: {
        organizationId: u.organizationId,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  // ─── Contacts / leads ──────────────────────────────────────────────────────

  async listContacts(u: AuthenticatedUser, q: ContactFilterDto) {
    const { page, limit, skip } = this.page(q);
    const where: Prisma.ContactWhereInput = { ...this.scope(u) };
    if (q.leadStatus) where.leadStatus = q.leadStatus;
    if (q.ownerId && u.role === Role.ADMIN) where.ownerId = q.ownerId;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: normalizePhone(q.search) ?? q.search } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        include: { owner: person, account: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return this.paginated(data, total, page, limit);
  }

  async createContact(u: AuthenticatedUser, dto: CreateContactDto) {
    const phone = normalizePhone(dto.phone);
    const email = dto.email?.trim().toLowerCase() || null;
    if (!phone && !email) throw new BadRequestException('Provide a phone number or an email');

    // Duplicate check is company-wide (not owner-scoped) so two salespeople never chase the same lead.
    const duplicate = await this.prisma.contact.findFirst({
      where: {
        organizationId: u.organizationId,
        OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
      },
      include: { owner: person },
    });
    if (duplicate) {
      throw new ConflictException({
        message: `This contact already exists${duplicate.owner ? ` (owned by ${duplicate.owner.name})` : ''}`,
        existingId: duplicate.id,
      });
    }

    const ownerId = await this.resolveOwner(u, dto.ownerId);
    await this.assertAccount(u, dto.accountId);

    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.create({
        data: {
          organizationId: u.organizationId,
          ownerId,
          accountId: dto.accountId,
          name: dto.name.trim(),
          phone,
          email,
          source: dto.source,
        },
      });
      await this.system(tx, u, contact.id, `Lead created (source: ${contact.source})`);
      if (dto.followUpAt) {
        await tx.crmActivity.create({
          data: {
            organizationId: u.organizationId,
            contactId: contact.id,
            ownerId,
            createdById: u.id,
            type: CrmActivityType.FOLLOW_UP,
            subject: 'First follow-up',
            dueAt: new Date(dto.followUpAt),
          },
        });
      }
      return contact;
    });
  }

  async getContact(u: AuthenticatedUser, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...this.scope(u) },
      include: {
        owner: person,
        account: true,
        deals: { include: { stage: true, owner: person }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async updateContact(u: AuthenticatedUser, id: string, dto: UpdateContactDto) {
    const current = await this.getContact(u, id);
    const ownerId = dto.ownerId !== undefined ? await this.resolveOwner(u, dto.ownerId) : current.ownerId;
    await this.assertAccount(u, dto.accountId);
    if (dto.leadStatus === LeadStatus.UNQUALIFIED && !(dto.lostReason ?? current.lostReason)) {
      throw new BadRequestException('Give a reason when marking a lead unqualified');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contact.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          phone: dto.phone !== undefined ? normalizePhone(dto.phone) : undefined,
          email: dto.email !== undefined ? dto.email.trim().toLowerCase() || null : undefined,
          leadStatus: dto.leadStatus,
          lostReason: dto.lostReason,
          accountId: dto.accountId,
          ownerId,
        },
        include: { owner: person },
      });
      if (dto.leadStatus && dto.leadStatus !== current.leadStatus) {
        await this.system(tx, u, id, `Lead status changed from ${current.leadStatus} to ${dto.leadStatus}`);
      }
      if (ownerId !== current.ownerId) {
        await this.system(tx, u, id, `Owner changed to ${updated.owner?.name ?? 'nobody'}`);
        // Pending follow-ups move with the lead so nothing is orphaned on the old owner.
        await tx.crmActivity.updateMany({ where: { contactId: id, completedAt: null }, data: { ownerId } });
      }
      return updated;
    });
  }

  /** Customer 360: every logged interaction, follow-up and change, newest first, plus the next action. */
  async timeline(u: AuthenticatedUser, id: string) {
    const contact = await this.getContact(u, id);
    const activities = await this.prisma.crmActivity.findMany({
      where: { contactId: id, organizationId: u.organizationId },
      include: { owner: person, createdBy: person, deal: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const nextAction =
      activities
        .filter((a) => !a.completedAt && a.dueAt)
        .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())[0] ?? null;
    return { contact, nextAction, activities };
  }

  // ─── Pipeline ──────────────────────────────────────────────────────────────

  async listStages(u: AuthenticatedUser) {
    const stages = await this.prisma.dealStage.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { position: 'asc' },
    });
    if (stages.length) return stages;
    await this.prisma.dealStage.createMany({
      data: DEFAULT_STAGES.map(([name, probability], position) => ({
        organizationId: u.organizationId,
        name,
        position,
        probability,
      })),
      skipDuplicates: true,
    });
    return this.prisma.dealStage.findMany({ where: { organizationId: u.organizationId }, orderBy: { position: 'asc' } });
  }

  createStage(u: AuthenticatedUser, dto: CreateStageDto) {
    return this.prisma.dealStage.create({
      data: { organizationId: u.organizationId, name: dto.name.trim(), position: dto.position, probability: dto.probability ?? 0 },
    });
  }

  private async resolveStage(u: AuthenticatedUser, stageId?: string) {
    if (!stageId) return (await this.listStages(u))[0];
    const stage = await this.prisma.dealStage.findFirst({ where: { id: stageId, organizationId: u.organizationId } });
    if (!stage) throw new BadRequestException('Stage not found');
    return stage;
  }

  // ─── Deals ─────────────────────────────────────────────────────────────────

  async listDeals(u: AuthenticatedUser, q: DealFilterDto) {
    const { page, limit, skip } = this.page(q);
    const where: Prisma.DealWhereInput = { ...this.scope(u) };
    if (q.status) where.status = q.status;
    if (q.stageId) where.stageId = q.stageId;
    if (q.search) where.title = { contains: q.search, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        include: { stage: true, owner: person, contact: { select: { id: true, name: true, phone: true } } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.deal.count({ where }),
    ]);
    return this.paginated(data, total, page, limit);
  }

  async createDeal(u: AuthenticatedUser, dto: CreateDealDto) {
    const contact = await this.getContact(u, dto.contactId);
    const stage = await this.resolveStage(u, dto.stageId);
    const ownerId = await this.resolveOwner(u, dto.ownerId ?? contact.ownerId ?? undefined);
    return this.prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          organizationId: u.organizationId,
          contactId: contact.id,
          accountId: contact.accountId,
          stageId: stage.id,
          ownerId,
          title: dto.title.trim(),
          value: dto.value ?? 0,
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        },
        include: { stage: true },
      });
      await this.system(tx, u, contact.id, `Deal "${deal.title}" opened at ${stage.name}`, deal.id);
      return deal;
    });
  }

  async updateDeal(u: AuthenticatedUser, id: string, dto: UpdateDealDto) {
    const deal = await this.prisma.deal.findFirst({ where: { id, ...this.scope(u) }, include: { stage: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (dto.status === DealStatus.LOST && !(dto.lostReason ?? deal.lostReason)) {
      throw new BadRequestException('Give a reason when marking a deal lost');
    }
    const stage = dto.stageId ? await this.resolveStage(u, dto.stageId) : deal.stage;
    const statusChanged = dto.status && dto.status !== deal.status;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deal.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          value: dto.value,
          stageId: stage.id,
          status: dto.status,
          lostReason: dto.lostReason,
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : undefined,
          closedAt: statusChanged ? (dto.status === DealStatus.OPEN ? null : new Date()) : undefined,
        },
        include: { stage: true },
      });
      if (stage.id !== deal.stageId) {
        await this.system(tx, u, deal.contactId, `Deal "${deal.title}" moved ${deal.stage.name} → ${stage.name}`, id);
      }
      if (statusChanged) {
        await this.system(tx, u, deal.contactId, `Deal "${deal.title}" marked ${dto.status}`, id);
        if (dto.status === DealStatus.WON) {
          await tx.contact.update({ where: { id: deal.contactId }, data: { leadStatus: LeadStatus.CUSTOMER } });
        }
      }
      return updated;
    });
  }

  // ─── Activities & follow-ups ───────────────────────────────────────────────

  async logActivity(u: AuthenticatedUser, dto: LogActivityDto) {
    const contact = await this.getContact(u, dto.contactId);
    if (dto.dealId && !contact.deals.some((d) => d.id === dto.dealId)) {
      throw new BadRequestException('Deal does not belong to this contact');
    }
    const done = !dto.dueAt;
    return this.prisma.$transaction(async (tx) => {
      const activity = await tx.crmActivity.create({
        data: {
          organizationId: u.organizationId,
          contactId: contact.id,
          dealId: dto.dealId,
          ownerId: contact.ownerId ?? u.id,
          createdById: u.id,
          type: dto.type,
          subject: dto.subject.trim(),
          notes: dto.notes,
          outcome: dto.outcome,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          completedAt: done ? new Date() : null,
        },
      });
      if (done) await this.markContacted(tx, u, contact.id, contact.leadStatus, dto.type);
      return activity;
    });
  }

  async completeActivity(u: AuthenticatedUser, id: string, dto: CompleteActivityDto) {
    const activity = await this.prisma.crmActivity.findFirst({
      where: { id, organizationId: u.organizationId },
      include: { contact: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    if (u.role !== Role.ADMIN && activity.ownerId !== u.id && activity.contact.ownerId !== u.id) {
      throw new ForbiddenException('You can only complete your own follow-ups');
    }
    if (activity.completedAt) throw new BadRequestException('Activity is already completed');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.crmActivity.update({
        where: { id },
        data: { completedAt: new Date(), outcome: dto.outcome, notes: dto.notes ?? activity.notes },
      });
      // A completed follow-up counts as reaching the lead.
      const touch = activity.type === CrmActivityType.FOLLOW_UP ? CrmActivityType.CALL : activity.type;
      await this.markContacted(tx, u, activity.contactId, activity.contact.leadStatus, touch);
      const next = dto.nextFollowUpAt
        ? await tx.crmActivity.create({
            data: {
              organizationId: u.organizationId,
              contactId: activity.contactId,
              dealId: activity.dealId,
              ownerId: activity.contact.ownerId ?? u.id,
              createdById: u.id,
              type: CrmActivityType.FOLLOW_UP,
              subject: 'Follow-up',
              dueAt: new Date(dto.nextFollowUpAt),
            },
          })
        : null;
      return { completed: updated, next };
    });
  }

  private async markContacted(tx: Tx, u: AuthenticatedUser, contactId: string, status: LeadStatus, type: CrmActivityType) {
    if (status !== LeadStatus.NEW || !TOUCH_TYPES.includes(type)) return;
    await tx.contact.update({ where: { id: contactId }, data: { leadStatus: LeadStatus.CONTACTED } });
    await this.system(tx, u, contactId, 'Lead status changed from NEW to CONTACTED');
  }

  /**
   * Revenue-leakage view: open leads with no scheduled next action, follow-ups past due, and the week ahead.
   * This is the "every open lead has a next action" rule made visible.
   */
  async attention(u: AuthenticatedUser) {
    const scope = this.scope(u);
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86400_000);
    const followUpInclude = { owner: person, contact: { select: { id: true, name: true, phone: true } } };
    const [noNextAction, overdue, upcoming] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          ...scope,
          leadStatus: { in: OPEN_LEAD_STATUSES },
          activities: { none: { completedAt: null, dueAt: { not: null } } },
        },
        include: { owner: person },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      this.prisma.crmActivity.findMany({
        where: { ...scope, completedAt: null, dueAt: { lt: now } },
        include: followUpInclude,
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
      this.prisma.crmActivity.findMany({
        where: { ...scope, completedAt: null, dueAt: { gte: now, lt: weekAhead } },
        include: followUpInclude,
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
    ]);
    return { noNextAction, overdue, upcoming };
  }
}
