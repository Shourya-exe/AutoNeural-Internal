import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrmActivityType, DealStatus, LeadStatus, Role } from '@prisma/client';
import { CrmService, normalizePhone } from './crm.service';

describe('CrmService', () => {
  const orgId = 'org-1';
  const admin = { id: 'admin-1', organizationId: orgId, email: 'a@x.in', name: 'Admin', role: Role.ADMIN } as const;
  const emp = { id: 'emp-1', organizationId: orgId, email: 'e@x.in', name: 'Emp', role: Role.EMPLOYEE } as const;
  const contact = { id: 'c-1', organizationId: orgId, ownerId: emp.id, accountId: null, leadStatus: LeadStatus.NEW, deals: [] };

  let prisma: any;
  let service: CrmService;

  beforeEach(() => {
    const model = () => ({
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'new-id', ...data })),
      createMany: jest.fn(),
      update: jest.fn().mockImplementation(({ data }) => ({ ...data })),
      updateMany: jest.fn(),
    });
    prisma = {
      contact: model(),
      account: model(),
      deal: model(),
      dealStage: model(),
      crmActivity: model(),
      user: model(),
      $transaction: jest.fn((fn) => fn(prisma)),
    };
    service = new CrmService(prisma);
  });

  it('normalizes phone formatting', () => {
    for (const p of ['+91 98765-43210', '98765 43210', '098765 43210', '919876543210']) {
      expect(normalizePhone(p)).toBe('+919876543210');
    }
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
    expect(normalizePhone('  ')).toBeNull();
  });

  describe('createContact', () => {
    it('rejects a lead with neither phone nor email', async () => {
      await expect(service.createContact(emp, { name: 'No Contact' })).rejects.toThrow(BadRequestException);
    });

    it('checks duplicates company-wide and returns the existing id', async () => {
      prisma.contact.findFirst.mockResolvedValue({ id: 'dup', owner: { name: 'Rahul' } });
      await expect(service.createContact(emp, { name: 'Lead', phone: '98765 43210' })).rejects.toThrow(ConflictException);
      expect(prisma.contact.findFirst.mock.calls[0][0].where).toEqual({
        organizationId: orgId,
        OR: [{ phone: '+919876543210' }],
      });
    });

    it('forbids employees from assigning leads to someone else', async () => {
      await expect(
        service.createContact(emp, { name: 'Lead', phone: '1', ownerId: 'other-user' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates the first follow-up so the lead has a next action', async () => {
      await service.createContact(emp, { name: 'Lead', phone: '1', followUpAt: '2026-10-01T10:00:00Z' });
      const created = prisma.crmActivity.create.mock.calls.map((c: any) => c[0].data);
      expect(created.map((d: any) => d.type)).toEqual([CrmActivityType.SYSTEM, CrmActivityType.FOLLOW_UP]);
      expect(created[1]).toMatchObject({ ownerId: emp.id });
      expect(created[1].completedAt).toBeUndefined();
    });
  });

  it('scopes employee reads to their own records and admin reads to the org', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    await expect(service.getContact(emp, 'c-9')).rejects.toThrow(NotFoundException);
    expect(prisma.contact.findFirst.mock.calls[0][0].where).toEqual({ id: 'c-9', organizationId: orgId, ownerId: emp.id });

    await service.attention(admin);
    expect(prisma.contact.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: orgId });
    expect(prisma.contact.findMany.mock.calls[0][0].where.ownerId).toBeUndefined();
  });

  it('logging a completed call moves a NEW lead to CONTACTED', async () => {
    prisma.contact.findFirst.mockResolvedValue(contact);
    await service.logActivity(emp, { contactId: contact.id, type: CrmActivityType.CALL, subject: 'Intro call' });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: contact.id },
      data: { leadStatus: LeadStatus.CONTACTED },
    });
  });

  it('scheduling a follow-up does not change lead status', async () => {
    prisma.contact.findFirst.mockResolvedValue(contact);
    await service.logActivity(emp, {
      contactId: contact.id,
      type: CrmActivityType.FOLLOW_UP,
      subject: 'Call back',
      dueAt: '2026-10-01T10:00:00Z',
    });
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it('employees cannot complete follow-ups they do not own', async () => {
    prisma.crmActivity.findFirst.mockResolvedValue({
      id: 'a-1',
      ownerId: 'someone',
      completedAt: null,
      contact: { ownerId: 'someone' },
    });
    await expect(service.completeActivity(emp, 'a-1', {})).rejects.toThrow(ForbiddenException);
  });

  describe('updateDeal', () => {
    const deal = { id: 'd-1', contactId: contact.id, stageId: 's-1', stage: { id: 's-1', name: 'New' }, status: DealStatus.OPEN, title: 'Website', lostReason: null };

    it('requires a reason to mark a deal lost', async () => {
      prisma.deal.findFirst.mockResolvedValue(deal);
      await expect(service.updateDeal(admin, deal.id, { status: DealStatus.LOST })).rejects.toThrow(BadRequestException);
    });

    it('winning a deal closes it and makes the contact a customer', async () => {
      prisma.deal.findFirst.mockResolvedValue(deal);
      await service.updateDeal(admin, deal.id, { status: DealStatus.WON });
      expect(prisma.deal.update.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: contact.id },
        data: { leadStatus: LeadStatus.CUSTOMER },
      });
    });
  });
});
