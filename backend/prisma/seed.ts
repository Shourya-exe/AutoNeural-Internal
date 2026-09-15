import {
  PrismaClient,
  Role,
  AccountStatus,
  TaskPriority,
  TaskStatus,
  ActivityAction,
  NotificationType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding AutoNeural CRM database...');

  // 1. Create Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'autoneural' },
    update: {},
    create: {
      name: 'AutoNeural Technologies',
      slug: 'autoneural',
    },
  });
  console.log(`Organization created: ${org.name} (${org.id})`);

  // 2. Default password hash
  const defaultPassword = 'Password123!';
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  // 3. Create Admin
  const admin = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'info@autoneural.in',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      email: 'info@autoneural.in',
      name: 'AutoNeural Admin',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      department: 'Management',
      jobTitle: 'System Administrator',
      passwordHash,
      mustChangePassword: false,
    },
  });
  console.log(`Admin created: ${admin.email}`);

  // 4. Create Employees
  const employeeData = [
    {
      name: 'Manyu',
      email: 'manyu@autoneural.in',
      department: 'Engineering',
      jobTitle: 'Backend Engineer',
    },
    {
      name: 'Rajashi',
      email: 'rajashi@autoneural.in',
      department: 'Product Design',
      jobTitle: 'UI/UX Designer',
    },
    {
      name: 'Shourya',
      email: 'shourya@autoneural.in',
      department: 'Product Management',
      jobTitle: 'Technical Lead',
      role: Role.ADMIN,
    },
    {
      name: 'Warrior Biswas',
      email: 'warriorbiswas@autoneural.in',
      department: 'Operations',
      jobTitle: 'Operations Lead',
      role: Role.EMPLOYEE,
    },
  ];

  const employees: Record<string, any> = {};

  for (const emp of employeeData) {
    const user = await prisma.user.upsert({
      where: {
        organizationId_email: {
          organizationId: org.id,
          email: emp.email,
        },
      },
      update: {
        role: emp.role || Role.EMPLOYEE,
      },
      create: {
        organizationId: org.id,
        email: emp.email,
        name: emp.name,
        role: emp.role || Role.EMPLOYEE,
        status: AccountStatus.ACTIVE,
        department: emp.department,
        jobTitle: emp.jobTitle,
        passwordHash,
        mustChangePassword: false,
      },
    });
    employees[emp.name] = user;
    console.log(`User created/updated: ${user.name} (${user.email}) [${user.role}]`);
  }

  // 5. Seed Tasks
  const sampleTasks = [
    {
      title: 'Design high-fidelity workflow builder UI',
      description: 'Create responsive Figma prototypes and high-fidelity specifications for node canvas.',
      priority: TaskPriority.HIGH,
      status: TaskStatus.IN_PROGRESS,
      progress: 45,
      project: 'Core Platform',
      assignee: employees['Rajashi'],
      dueDate: new Date(Date.now() + 5 * 86400000),
    },
    {
      title: 'Implement OAuth2 & Refresh Token rotation',
      description: 'Secure JWT authentication lifecycle with database-backed token blacklisting.',
      priority: TaskPriority.URGENT,
      status: TaskStatus.IN_PROGRESS,
      progress: 70,
      project: 'Security',
      assignee: employees['Manyu'],
      dueDate: new Date(Date.now() + 2 * 86400000),
    },
    {
      title: 'Audit client onboarding checklist and operational SOPs',
      description: 'Review SLA adherence and operational bottlenecks for enterprise tier.',
      priority: TaskPriority.MEDIUM,
      status: TaskStatus.TODO,
      progress: 0,
      project: 'Operations',
      assignee: employees['Warrior Biswas'],
      dueDate: new Date(Date.now() + 7 * 86400000),
    },
    {
      title: 'Draft Q4 Product Roadmap & Milestone Specs',
      description: 'Consolidate stakeholder requirements and align technical delivery milestones.',
      priority: TaskPriority.HIGH,
      status: TaskStatus.COMPLETED,
      progress: 100,
      project: 'Product',
      assignee: employees['Shourya'],
      dueDate: new Date(Date.now() - 1 * 86400000),
      completedAt: new Date(Date.now() - 1 * 86400000),
    },
  ];

  for (const t of sampleTasks) {
    const existingTask = await prisma.task.findFirst({
      where: {
        organizationId: org.id,
        title: t.title,
      },
    });

    if (!existingTask) {
      const task = await prisma.task.create({
        data: {
          organizationId: org.id,
          createdById: admin.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          progress: t.progress,
          project: t.project,
          dueDate: t.dueDate,
          completedAt: t.completedAt || null,
          assignments: {
            create: {
              employeeId: t.assignee.id,
            },
          },
          activities: {
            create: [
              {
                userId: admin.id,
                action: ActivityAction.CREATED,
                newValue: `Created task "${t.title}"`,
              },
              {
                userId: admin.id,
                action: ActivityAction.ASSIGNED,
                newValue: `Assigned to ${t.assignee.name}`,
              },
            ],
          },
          comments: {
            create: {
              authorId: admin.id,
              content: 'Please prioritize this item according to the project timeline.',
            },
          },
        },
      });

      // Also create a notification for the assigned employee
      await prisma.notification.create({
        data: {
          userId: t.assignee.id,
          taskId: task.id,
          type: NotificationType.TASK_ASSIGNED,
          title: 'New Task Assigned',
          message: `You were assigned task "${task.title}" by ${admin.name}.`,
        },
      });

      console.log(`Task created: #${task.number} - ${task.title}`);
    }
  }

  console.log('\nSeeding completed successfully!');
  console.log('----------------------------------------------------');
  console.log('Default credentials for all accounts:');
  console.log('Password: Password123!');
  console.log('Admin:    info@autoneural.in');
  console.log('Employees: manyu@autoneural.in, rajashi@autoneural.in,');
  console.log('           shourya@autoneural.in, warriorbiswas@autoneural.in');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
