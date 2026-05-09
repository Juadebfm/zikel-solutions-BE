import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  AuditAction,
  Prisma,
  SafeguardingRiskAlertSeverity,
  SafeguardingRiskAlertStatus,
  TaskApprovalStatus,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TicketStatus,
} from '@prisma/client';
import type { ExportColumn } from '../../lib/export.js';
import { httpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireTenantContext } from '../../lib/tenant-context.js';
import type {
  EvidencePackQuery,
  EvidencePackType,
  RiDashboardDrilldownQuery,
  RiDashboardMetric,
  RiDashboardQuery,
} from './reports.schema.js';

const ACTIVE_TASK_STATUSES: TaskStatus[] = [TaskStatus.pending, TaskStatus.in_progress];
const HIGH_PRIORITY_TASKS: TaskPriority[] = [TaskPriority.high, TaskPriority.urgent];
const OPEN_RISK_ALERT_STATUSES: SafeguardingRiskAlertStatus[] = [
  SafeguardingRiskAlertStatus.new,
  SafeguardingRiskAlertStatus.acknowledged,
  SafeguardingRiskAlertStatus.in_progress,
];

type EvidenceTaskRow = Prisma.TaskGetPayload<{
  include: {
    home: { select: { id: true; name: true } };
    assignee: {
      select: {
        id: true;
        user: { select: { firstName: true; lastName: true } };
      };
    };
  };
}>;

const TASK_EVIDENCE_INCLUDE = {
  home: { select: { id: true, name: true } },
  assignee: {
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

type PackRiskLevel = 'low' | 'medium' | 'high' | 'critical';

type EvidenceTask = {
  id: string;
  title: string;
  category: string;
  status: string;
  approvalStatus: string;
  priority: string;
  createdAt: string;
  dueDate: string | null;
  completedAt: string | null;
  home: string | null;
  assignee: string | null;
  description: string | null;
};

type EvidenceAudit = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  actor: string | null;
};

type EvidenceHomeEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  home: string | null;
};

type EvidenceShift = {
  id: string;
  startTime: string;
  endTime: string;
  home: string | null;
  employee: string | null;
};

type ChronologyEntry = {
  at: string;
  type: 'incident' | 'daily_log' | 'approval' | 'event';
  title: string;
  referenceId: string | null;
  details: string;
};

export type EvidencePack = {
  packType: EvidencePackType;
  title: string;
  generatedAt: string;
  generatedBy: {
    id: string;
    name: string | null;
    email: string | null;
  };
  scope: {
    tenantId: string;
    homeId: string | null;
    dateFrom: string;
    dateTo: string;
    timezone: 'UTC';
  };
  summary: {
    headline: string;
    riskLevel: PackRiskLevel;
    riskScore: number;
    totals: {
      totalTasks: number;
      openTasks: number;
      completedTasks: number;
      overdueTasks: number;
      unassignedActiveTasks: number;
      incidents: number;
      dailyLogs: number;
      pendingApprovals: number;
      rejectedApprovals: number;
      approvedApprovals: number;
      regTaggedRecords: number;
      auditEvents: number;
      homeEvents: number;
      scheduledShifts: number;
      activeEmployees: number;
      openSupportTickets: number;
    };
  };
  sections: {
    compliance: {
      summary: string;
      metrics: Record<string, number>;
      gaps: string[];
      highlights: string[];
    };
    safeguarding: {
      summary: string;
      metrics: Record<string, number>;
      topIncidentThemes: Array<{ theme: string; count: number }>;
      gaps: string[];
    };
    staffing: {
      summary: string;
      metrics: Record<string, number>;
      gaps: string[];
    };
    governance: {
      summary: string;
      metrics: Record<string, number>;
      highlights: string[];
    };
  };
  chronology: ChronologyEntry[];
  evidence: {
    regulatory: EvidenceTask[];
    incidents: EvidenceTask[];
    dailyLogs: EvidenceTask[];
    approvals: EvidenceTask[];
    audits: EvidenceAudit[];
    homeEvents: EvidenceHomeEvent[];
    shifts: EvidenceShift[];
  };
  provenance: {
    generatedByUserId: string;
    generatedAt: string;
    sourceCounts: Record<string, number>;
    checksumSha256: string;
  };
};

export type EvidencePackExport = {
  title: string;
  subtitle: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
};

export type BinaryExportAsset = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

function toDisplayName(person: { firstName?: string | null; lastName?: string | null } | null): string | null {
  if (!person) return null;
  const full = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
  return full || null;
}

function compactText(value: string | null | undefined, max = 180): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function parseDateBoundary(raw: string | undefined, boundary: 'start' | 'end'): Date | null {
  if (!raw) return null;
  const normalized = raw.includes('T')
    ? raw
    : `${raw}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(422, 'VALIDATION_ERROR', `Invalid ${boundary === 'start' ? 'dateFrom' : 'dateTo'} value.`);
  }
  return parsed;
}

function resolveWindow(packType: EvidencePackType, query: EvidencePackQuery) {
  const now = new Date();
  const defaultDays = packType === 'reg44' ? 30 : 90;
  const defaultStart = new Date(now.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  const start = parseDateBoundary(query.dateFrom, 'start') ?? defaultStart;
  const end = parseDateBoundary(query.dateTo, 'end') ?? now;
  if (start > end) {
    throw httpError(422, 'VALIDATION_ERROR', '`dateFrom` cannot be later than `dateTo`.');
  }
  return { start, end };
}

function regSearchTokens(packType: EvidencePackType) {
  if (packType === 'reg44') {
    return ['reg44', 'reg 44'];
  }
  return ['reg45', 'reg 45'];
}

function classifyTheme(input: string): string {
  const text = input.toLowerCase();
  if (text.includes('medication')) return 'Medication';
  if (text.includes('abscond') || text.includes('missing')) return 'Missing From Home';
  if (text.includes('safeguard')) return 'Safeguarding';
  if (text.includes('behaviour') || text.includes('aggression')) return 'Behaviour';
  if (text.includes('health') || text.includes('injury')) return 'Health/Injury';
  if (text.includes('education')) return 'Education';
  return 'General';
}

function mapTaskEvidence(task: EvidenceTaskRow): EvidenceTask {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    createdAt: task.createdAt.toISOString(),
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    home: task.home?.name ?? null,
    assignee: task.assignee?.user ? toDisplayName(task.assignee.user) : null,
    description: compactText(task.description),
  };
}

function riskLevelFromScore(score: number): PackRiskLevel {
  if (score >= 120) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function buildHeadline(args: {
  riskLevel: PackRiskLevel;
  packType: EvidencePackType;
  pendingApprovals: number;
  overdueTasks: number;
  incidents: number;
}) {
  const label = args.packType === 'reg44' ? 'Reg 44' : 'Reg 45';
  if (args.riskLevel === 'critical' || args.riskLevel === 'high') {
    return `${label} evidence pack highlights elevated operational risk requiring immediate follow-up.`;
  }
  if (args.pendingApprovals > 0 || args.overdueTasks > 0 || args.incidents > 0) {
    return `${label} evidence pack shows active risk items that should be reviewed in this cycle.`;
  }
  return `${label} evidence pack shows stable activity within the selected period.`;
}

function buildRegWhere(packType: EvidencePackType): Prisma.TaskWhereInput {
  const tokens = regSearchTokens(packType);
  const orClauses: Prisma.TaskWhereInput[] = [];
  for (const token of tokens) {
    orClauses.push({ formTemplateKey: { contains: token, mode: 'insensitive' } });
    orClauses.push({ formGroup: { contains: token, mode: 'insensitive' } });
    orClauses.push({ title: { contains: token, mode: 'insensitive' } });
    orClauses.push({ description: { contains: token, mode: 'insensitive' } });
  }
  return { OR: orClauses };
}

export async function generateEvidencePack(
  actorUserId: string,
  packType: EvidencePackType,
  query: EvidencePackQuery,
): Promise<EvidencePack> {
  const tenant = await requireTenantContext(actorUserId);
  const { start, end } = resolveWindow(packType, query);
  const maxEvidenceItems = query.maxEvidenceItems;

  if (query.homeId) {
    const home = await prisma.home.findFirst({
      where: { id: query.homeId, tenantId: tenant.tenantId, isActive: true },
      select: { id: true },
    });
    if (!home) {
      throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
    }
  }

  const taskBaseWhere: Prisma.TaskWhereInput = {
    tenantId: tenant.tenantId,
    deletedAt: null,
    createdAt: { gte: start, lte: end },
    ...(query.homeId ? { homeId: query.homeId } : {}),
  };

  const [actor, totalTasks, openTasks, completedTasks, overdueTasks, unassignedActiveTasks, pendingApprovals, rejectedApprovals, approvedApprovals, activeEmployees, incidents, dailyLogs, regulatory, approvals, audits, homeEvents, shifts, openSupportTickets] =
    await Promise.all([
      prisma.tenantUser.findUnique({
        where: { id: actorUserId },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      prisma.task.count({
        where: taskBaseWhere,
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, status: { in: ACTIVE_TASK_STATUSES } },
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, status: TaskStatus.completed },
      }),
      prisma.task.count({
        where: {
          ...taskBaseWhere,
          status: { in: ACTIVE_TASK_STATUSES },
          dueDate: { lt: new Date() },
        },
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, status: { in: ACTIVE_TASK_STATUSES }, assigneeId: null },
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, approvalStatus: TaskApprovalStatus.pending_approval },
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, approvalStatus: TaskApprovalStatus.rejected },
      }),
      prisma.task.count({
        where: { ...taskBaseWhere, approvalStatus: TaskApprovalStatus.approved },
      }),
      prisma.employee.count({
        where: {
          tenantId: tenant.tenantId,
          isActive: true,
          ...(query.homeId ? { homeId: query.homeId } : {}),
        },
      }),
      prisma.task.findMany({
        where: { ...taskBaseWhere, category: TaskCategory.incident },
        include: TASK_EVIDENCE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.task.findMany({
        where: { ...taskBaseWhere, category: TaskCategory.daily_log },
        include: TASK_EVIDENCE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.task.findMany({
        where: { AND: [taskBaseWhere, buildRegWhere(packType)] },
        include: TASK_EVIDENCE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.task.findMany({
        where: {
          ...taskBaseWhere,
          approvalStatus: {
            in: [
              TaskApprovalStatus.pending_approval,
              TaskApprovalStatus.rejected,
              TaskApprovalStatus.approved,
            ],
          },
        },
        include: TASK_EVIDENCE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.auditLog.findMany({
        where: {
          tenantId: tenant.tenantId,
          createdAt: { gte: start, lte: end },
        },
        include: {
          user: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.homeEvent.findMany({
        where: {
          tenantId: tenant.tenantId,
          startsAt: { gte: start, lte: end },
          ...(query.homeId ? { homeId: query.homeId } : {}),
        },
        include: {
          home: {
            select: { name: true },
          },
        },
        orderBy: { startsAt: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.employeeShift.findMany({
        where: {
          tenantId: tenant.tenantId,
          startTime: { gte: start, lte: end },
          ...(query.homeId ? { homeId: query.homeId } : {}),
        },
        include: {
          home: { select: { name: true } },
          employee: {
            select: {
              user: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { startTime: 'desc' },
        take: maxEvidenceItems,
      }),
      prisma.supportTicket.count({
        where: {
          tenantId: tenant.tenantId,
          status: { in: [TicketStatus.open, TicketStatus.in_progress, TicketStatus.waiting_on_customer] },
        },
      }),
    ]);

  if (!actor) {
    throw httpError(404, 'USER_NOT_FOUND', 'User not found.');
  }

  const incidentThemesMap = new Map<string, number>();
  incidents.forEach((incident) => {
    const theme = classifyTheme(`${incident.title} ${incident.description ?? ''}`);
    incidentThemesMap.set(theme, (incidentThemesMap.get(theme) ?? 0) + 1);
  });
  const topIncidentThemes = Array.from(incidentThemesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([theme, count]) => ({ theme, count }));

  const riskScore = (
    overdueTasks * 4 +
    pendingApprovals * 3 +
    rejectedApprovals * 5 +
    incidents.length * 4 +
    unassignedActiveTasks * 2 +
    openSupportTickets * 2 +
    (regulatory.length === 0 ? 20 : 0)
  );
  const riskLevel = riskLevelFromScore(riskScore);
  const headline = buildHeadline({
    packType,
    riskLevel,
    pendingApprovals,
    overdueTasks,
    incidents: incidents.length,
  });

  const complianceGaps: string[] = [];
  if (regulatory.length === 0) {
    complianceGaps.push(`No ${packType.toUpperCase()}-tagged records found within the selected window.`);
  }
  if (pendingApprovals > 0) {
    complianceGaps.push(`${pendingApprovals} item(s) still awaiting sign-off.`);
  }
  if (rejectedApprovals > 0) {
    complianceGaps.push(`${rejectedApprovals} item(s) were rejected and need correction evidence.`);
  }

  const safeguardingGaps: string[] = [];
  if (incidents.length > 0 && dailyLogs.length === 0) {
    safeguardingGaps.push('Incidents exist but no daily-log evidence was found in this range.');
  }
  if (incidents.length === 0) {
    safeguardingGaps.push('No incident records were captured in this range.');
  }

  const staffingGaps: string[] = [];
  if (activeEmployees === 0) staffingGaps.push('No active employees found for the selected scope.');
  if (shifts.length === 0) staffingGaps.push('No scheduled shifts recorded in selected date range.');
  if (unassignedActiveTasks > 0) staffingGaps.push(`${unassignedActiveTasks} active task(s) are unassigned.`);

  const mappedRegulatory = regulatory.map(mapTaskEvidence);
  const mappedIncidents = incidents.map(mapTaskEvidence);
  const mappedDailyLogs = dailyLogs.map(mapTaskEvidence);
  const mappedApprovals = approvals.map(mapTaskEvidence);
  const mappedAudits: EvidenceAudit[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    entityType: audit.entityType ?? null,
    entityId: audit.entityId ?? null,
    createdAt: audit.createdAt.toISOString(),
    actor: audit.user ? toDisplayName(audit.user) : null,
  }));
  const mappedHomeEvents: EvidenceHomeEvent[] = homeEvents.map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt ? event.endsAt.toISOString() : null,
    home: event.home?.name ?? null,
  }));
  const mappedShifts: EvidenceShift[] = shifts.map((shift) => ({
    id: shift.id,
    startTime: shift.startTime.toISOString(),
    endTime: shift.endTime.toISOString(),
    home: shift.home?.name ?? null,
    employee: shift.employee?.user ? toDisplayName(shift.employee.user) : null,
  }));

  const chronology: ChronologyEntry[] = [
    ...mappedIncidents.map((item) => ({
      at: item.createdAt,
      type: 'incident' as const,
      title: item.title,
      referenceId: item.id,
      details: item.description ?? 'Incident logged.',
    })),
    ...mappedDailyLogs.map((item) => ({
      at: item.createdAt,
      type: 'daily_log' as const,
      title: item.title,
      referenceId: item.id,
      details: item.description ?? 'Daily log submitted.',
    })),
    ...mappedApprovals.map((item) => ({
      at: item.createdAt,
      type: 'approval' as const,
      title: item.title,
      referenceId: item.id,
      details: `Approval status: ${item.approvalStatus}.`,
    })),
    ...mappedHomeEvents.map((item) => ({
      at: item.startsAt,
      type: 'event' as const,
      title: item.title,
      referenceId: item.id,
      details: item.home ? `Home event for ${item.home}.` : 'Home event.',
    })),
  ]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-Math.min(200, maxEvidenceItems));

  const pack: EvidencePack = {
    packType,
    title: packType === 'reg44' ? 'Reg 44 Evidence Pack' : 'Reg 45 Evidence Pack',
    generatedAt: new Date().toISOString(),
    generatedBy: {
      id: actor.id,
      name: toDisplayName(actor),
      email: actor.email ?? null,
    },
    scope: {
      tenantId: tenant.tenantId,
      homeId: query.homeId ?? null,
      dateFrom: start.toISOString(),
      dateTo: end.toISOString(),
      timezone: 'UTC',
    },
    summary: {
      headline,
      riskLevel,
      riskScore,
      totals: {
        totalTasks,
        openTasks,
        completedTasks,
        overdueTasks,
        unassignedActiveTasks,
        incidents: mappedIncidents.length,
        dailyLogs: mappedDailyLogs.length,
        pendingApprovals,
        rejectedApprovals,
        approvedApprovals,
        regTaggedRecords: mappedRegulatory.length,
        auditEvents: mappedAudits.length,
        homeEvents: mappedHomeEvents.length,
        scheduledShifts: mappedShifts.length,
        activeEmployees,
        openSupportTickets,
      },
    },
    sections: {
      compliance: {
        summary: `Compliance evidence for ${packType.toUpperCase()} with approval and sign-off posture.`,
        metrics: {
          regTaggedRecords: mappedRegulatory.length,
          pendingApprovals,
          rejectedApprovals,
          approvedApprovals,
        },
        gaps: complianceGaps,
        highlights: [
          `${approvedApprovals} approved record(s) in selected period.`,
          `${mappedRegulatory.length} regulatory-tagged record(s) captured.`,
        ],
      },
      safeguarding: {
        summary: 'Safeguarding signal across incidents and daily-log entries.',
        metrics: {
          incidents: mappedIncidents.length,
          dailyLogs: mappedDailyLogs.length,
          overdueTasks,
        },
        topIncidentThemes,
        gaps: safeguardingGaps,
      },
      staffing: {
        summary: 'Staffing posture and task ownership coverage.',
        metrics: {
          activeEmployees,
          scheduledShifts: mappedShifts.length,
          unassignedActiveTasks,
        },
        gaps: staffingGaps,
      },
      governance: {
        summary: 'Governance and assurance signals from audit and operations events.',
        metrics: {
          auditEvents: mappedAudits.length,
          homeEvents: mappedHomeEvents.length,
          openSupportTickets,
        },
        highlights: [
          `${mappedAudits.filter((audit) => audit.action === 'permission_changed').length} permission-change audit event(s).`,
          `${mappedHomeEvents.length} home event(s) recorded in scope.`,
        ],
      },
    },
    chronology,
    evidence: {
      regulatory: mappedRegulatory,
      incidents: mappedIncidents,
      dailyLogs: mappedDailyLogs,
      approvals: mappedApprovals,
      audits: mappedAudits,
      homeEvents: mappedHomeEvents,
      shifts: mappedShifts,
    },
    provenance: {
      generatedByUserId: actorUserId,
      generatedAt: new Date().toISOString(),
      sourceCounts: {
        regulatory: mappedRegulatory.length,
        incidents: mappedIncidents.length,
        dailyLogs: mappedDailyLogs.length,
        approvals: mappedApprovals.length,
        audits: mappedAudits.length,
        homeEvents: mappedHomeEvents.length,
        shifts: mappedShifts.length,
      },
      checksumSha256: '',
    },
  };

  const checksumSha256 = createHash('sha256')
    .update(JSON.stringify({
      packType: pack.packType,
      scope: pack.scope,
      summary: pack.summary,
      sections: pack.sections,
      evidence: pack.evidence,
      chronology: pack.chronology,
    }))
    .digest('hex');
  pack.provenance.checksumSha256 = checksumSha256;

  return pack;
}

export function toEvidencePackExport(pack: EvidencePack): EvidencePackExport {
  const columns: ExportColumn[] = [
    { header: 'Section', key: 'section', width: 120 },
    { header: 'Item', key: 'item', width: 180 },
    { header: 'Value', key: 'value', width: 120 },
    { header: 'Status', key: 'status', width: 90 },
    { header: 'Date', key: 'date', width: 120 },
    { header: 'Reference', key: 'reference', width: 140 },
    { header: 'Notes', key: 'notes', width: 260 },
  ];

  const rows: Record<string, unknown>[] = [];

  const pushMetricRows = (section: string, metrics: Record<string, number>) => {
    Object.entries(metrics).forEach(([key, value]) => {
      rows.push({
        section,
        item: key,
        value,
        status: '',
        date: '',
        reference: '',
        notes: '',
      });
    });
  };

  pushMetricRows('Summary', pack.summary.totals);
  pushMetricRows('Compliance', pack.sections.compliance.metrics);
  pushMetricRows('Safeguarding', pack.sections.safeguarding.metrics);
  pushMetricRows('Staffing', pack.sections.staffing.metrics);
  pushMetricRows('Governance', pack.sections.governance.metrics);

  pack.chronology.slice(0, 60).forEach((entry) => {
    rows.push({
      section: 'Chronology',
      item: entry.title,
      value: entry.type,
      status: '',
      date: entry.at,
      reference: entry.referenceId ?? '',
      notes: entry.details,
    });
  });

  pack.evidence.regulatory.slice(0, 40).forEach((entry) => {
    rows.push({
      section: 'Regulatory',
      item: entry.title,
      value: entry.category,
      status: `${entry.status}/${entry.approvalStatus}`,
      date: entry.createdAt,
      reference: entry.id,
      notes: entry.description ?? '',
    });
  });

  const subtitle = `${pack.scope.dateFrom.slice(0, 10)} to ${pack.scope.dateTo.slice(0, 10)}${pack.scope.homeId ? ` • home:${pack.scope.homeId}` : ''}`;

  return {
    title: pack.title,
    subtitle,
    columns,
    rows,
  };
}

function toSafeFileStem(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/g, '');
}

export async function toEvidencePackZipBundle(args: {
  pack: EvidencePack;
  pdf: BinaryExportAsset;
  excel: BinaryExportAsset;
}): Promise<BinaryExportAsset> {
  const { pack, pdf, excel } = args;
  const generatedAt = new Date();
  const dateSuffix = generatedAt.toISOString().slice(0, 10);
  const safeTitle = toSafeFileStem(pack.title || `${pack.packType}-evidence-pack`);
  const zip = new JSZip();

  const bundleManifest = {
    bundleType: 'evidence_pack_bundle',
    bundleVersion: '1.0',
    generatedAt: generatedAt.toISOString(),
    packType: pack.packType,
    title: pack.title,
    scope: pack.scope,
    provenance: pack.provenance,
    files: [
      'README.txt',
      'manifest.json',
      'pack/evidence-pack.json',
      `pack/${pdf.filename}`,
      `pack/${excel.filename}`,
      'evidence/chronology.json',
      'evidence/regulatory.json',
      'evidence/incidents.json',
      'evidence/daily-logs.json',
      'evidence/approvals.json',
      'evidence/audits.json',
      'evidence/home-events.json',
      'evidence/shifts.json',
    ],
  };

  zip.file(
    'README.txt',
    [
      'Zikel Solutions Regulatory Evidence Bundle',
      '',
      `Pack: ${pack.title}`,
      `Type: ${pack.packType.toUpperCase()}`,
      `Generated At (UTC): ${bundleManifest.generatedAt}`,
      '',
      'This ZIP includes:',
      '- Full structured evidence pack JSON',
      '- PDF export',
      '- XLSX export',
      '- Split evidence JSON artifacts for chronology and evidence buckets',
      '',
      'Use manifest.json for checksums, scope, and provenance context.',
    ].join('\n'),
  );

  zip.file('manifest.json', JSON.stringify(bundleManifest, null, 2));
  zip.file('pack/evidence-pack.json', JSON.stringify(pack, null, 2));
  zip.file(`pack/${pdf.filename}`, pdf.buffer);
  zip.file(`pack/${excel.filename}`, excel.buffer);
  zip.file('evidence/chronology.json', JSON.stringify(pack.chronology, null, 2));
  zip.file('evidence/regulatory.json', JSON.stringify(pack.evidence.regulatory, null, 2));
  zip.file('evidence/incidents.json', JSON.stringify(pack.evidence.incidents, null, 2));
  zip.file('evidence/daily-logs.json', JSON.stringify(pack.evidence.dailyLogs, null, 2));
  zip.file('evidence/approvals.json', JSON.stringify(pack.evidence.approvals, null, 2));
  zip.file('evidence/audits.json', JSON.stringify(pack.evidence.audits, null, 2));
  zip.file('evidence/home-events.json', JSON.stringify(pack.evidence.homeEvents, null, 2));
  zip.file('evidence/shifts.json', JSON.stringify(pack.evidence.shifts, null, 2));

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return {
    buffer,
    contentType: 'application/zip',
    filename: `${safeTitle}-evidence-bundle-${dateSuffix}.zip`,
  };
}

type RiKpiLevel = 'good' | 'watch' | 'critical';

type RiScopeInput = {
  homeId?: string | undefined;
  careGroupId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
};

type RiWindow = {
  start: Date;
  end: Date;
};

type RiScope = {
  tenantId: string;
  homeId: string | null;
  careGroupId: string | null;
  dateFrom: string;
  dateTo: string;
  timezone: 'UTC';
};

export type RiDashboardReport = {
  generatedAt: string;
  scope: RiScope;
  kpis: {
    compliance: {
      score: number;
      level: RiKpiLevel;
      pendingApprovals: number;
      rejectedApprovals: number;
      overdueTasks: number;
    };
    safeguardingRisk: {
      score: number;
      level: RiKpiLevel;
      incidentTasks: number;
      openAlerts: {
        total: number;
        critical: number;
        high: number;
        medium: number;
      };
    };
    staffingPressure: {
      score: number;
      level: RiKpiLevel;
      activeEmployees: number;
      scheduledShifts: number;
      unassignedActiveTasks: number;
      highPriorityOpenTasks: number;
    };
    actionCompletion: {
      score: number;
      level: RiKpiLevel;
      completionRate: number;
      completedTasks: number;
      activeTasks: number;
      approvalsClosed: number;
      approvalsPending: number;
    };
  };
  totals: {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    overdueTasks: number;
    pendingApprovals: number;
    rejectedApprovals: number;
    approvedApprovals: number;
    incidentTasks: number;
    openRiskAlerts: number;
    activeEmployees: number;
    scheduledShifts: number;
  };
  highlights: string[];
  atRiskHomes: Array<{
    homeId: string;
    homeName: string;
    careGroupId: string | null;
    careGroupName: string | null;
    riskScore: number;
    signals: {
      activeTasks: number;
      overdueTasks: number;
      pendingApprovals: number;
      rejectedApprovals: number;
      openAlertsCritical: number;
      openAlertsHigh: number;
      openAlertsMedium: number;
    };
  }>;
};

export type RiDashboardDrilldownRow = {
  id: string;
  metric: RiDashboardMetric;
  title: string;
  signal: string;
  status: string;
  priority: string | null;
  severity: string | null;
  homeId: string | null;
  homeName: string | null;
  careGroupId: string | null;
  careGroupName: string | null;
  dueAt: string | null;
  happenedAt: string;
  referenceType: 'task' | 'risk_alert';
  referenceId: string;
};

export type RiDashboardDrilldownReport = {
  generatedAt: string;
  scope: RiScope;
  metric: RiDashboardMetric;
  data: RiDashboardDrilldownRow[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

const RI_DRILLDOWN_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  approvalStatus: true,
  priority: true,
  assigneeId: true,
  dueDate: true,
  createdAt: true,
  home: {
    select: {
      id: true,
      name: true,
      careGroup: { select: { id: true, name: true } },
    },
  },
} as const;

type RiTaskDrilldownRow = Prisma.TaskGetPayload<{
  select: typeof RI_DRILLDOWN_TASK_SELECT;
}>;

const RI_DRILLDOWN_ALERT_SELECT = {
  id: true,
  title: true,
  type: true,
  severity: true,
  status: true,
  lastTriggeredAt: true,
  home: {
    select: {
      id: true,
      name: true,
      careGroup: { select: { id: true, name: true } },
    },
  },
} as const;

type RiAlertDrilldownRow = Prisma.SafeguardingRiskAlertGetPayload<{
  select: typeof RI_DRILLDOWN_ALERT_SELECT;
}>;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function metricLevelFromScore(score: number): RiKpiLevel {
  if (score < 45) return 'critical';
  if (score < 75) return 'watch';
  return 'good';
}

function buildPaginationMeta(total: number, page: number, pageSize: number) {
  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function resolveRiWindow(query: RiScopeInput): RiWindow {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const start = parseDateBoundary(query.dateFrom, 'start') ?? defaultStart;
  const end = parseDateBoundary(query.dateTo, 'end') ?? now;
  if (start > end) {
    throw httpError(422, 'VALIDATION_ERROR', '`dateFrom` cannot be later than `dateTo`.');
  }
  return { start, end };
}

function buildRiScope(tenantId: string, query: RiScopeInput, window: RiWindow): RiScope {
  return {
    tenantId,
    homeId: query.homeId ?? null,
    careGroupId: query.careGroupId ?? null,
    dateFrom: window.start.toISOString(),
    dateTo: window.end.toISOString(),
    timezone: 'UTC',
  };
}

async function validateRiScope(tenantId: string, query: RiScopeInput) {
  if (query.careGroupId) {
    const careGroup = await prisma.careGroup.findFirst({
      where: { id: query.careGroupId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!careGroup) {
      throw httpError(404, 'CARE_GROUP_NOT_FOUND', 'Care group not found.');
    }
  }

  if (query.homeId) {
    const home = await prisma.home.findFirst({
      where: {
        id: query.homeId,
        tenantId,
        isActive: true,
        ...(query.careGroupId ? { careGroupId: query.careGroupId } : {}),
      },
      select: { id: true },
    });
    if (!home) {
      throw httpError(404, 'HOME_NOT_FOUND', 'Home not found.');
    }
  }
}

function buildRiTaskWhere(
  tenantId: string,
  query: RiScopeInput,
  window: RiWindow,
): Prisma.TaskWhereInput {
  return {
    tenantId,
    deletedAt: null,
    createdAt: { gte: window.start, lte: window.end },
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.careGroupId ? { home: { is: { careGroupId: query.careGroupId } } } : {}),
  };
}

function buildRiEmployeeWhere(
  tenantId: string,
  query: RiScopeInput,
): Prisma.EmployeeWhereInput {
  return {
    tenantId,
    isActive: true,
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.careGroupId ? { home: { is: { careGroupId: query.careGroupId } } } : {}),
  };
}

function buildRiShiftWhere(
  tenantId: string,
  query: RiScopeInput,
  window: RiWindow,
): Prisma.EmployeeShiftWhereInput {
  return {
    tenantId,
    startTime: { gte: window.start, lte: window.end },
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.careGroupId ? { home: { is: { careGroupId: query.careGroupId } } } : {}),
  };
}

function buildRiAlertWhere(
  tenantId: string,
  query: RiScopeInput,
  window: RiWindow,
): Prisma.SafeguardingRiskAlertWhereInput {
  return {
    tenantId,
    lastTriggeredAt: { gte: window.start, lte: window.end },
    ...(query.homeId ? { homeId: query.homeId } : {}),
    ...(query.careGroupId ? { home: { is: { careGroupId: query.careGroupId } } } : {}),
  };
}

async function logRiDashboardAccess(args: {
  tenantId: string;
  userId: string;
  entityType: 'ri_dashboard_overview' | 'ri_dashboard_drilldown';
  metadata: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      tenantId: args.tenantId,
      userId: args.userId,
      action: AuditAction.record_accessed,
      entityType: args.entityType,
      metadata: args.metadata,
    },
  });
}

function mapTaskToDrilldownRow(
  metric: RiDashboardMetric,
  task: RiTaskDrilldownRow,
  now: Date,
): RiDashboardDrilldownRow {
  const isOverdue =
    task.dueDate !== null &&
    ACTIVE_TASK_STATUSES.includes(task.status) &&
    task.dueDate.getTime() < now.getTime();

  const signal =
    metric === 'compliance'
      ? task.approvalStatus === TaskApprovalStatus.rejected
        ? 'rejected'
        : task.approvalStatus === TaskApprovalStatus.pending_approval
          ? 'pending_signoff'
          : isOverdue
            ? 'overdue'
            : 'attention'
      : metric === 'staffing_pressure'
        ? task.assigneeId === null
          ? 'unassigned'
          : HIGH_PRIORITY_TASKS.includes(task.priority)
            ? 'high_priority'
            : isOverdue
              ? 'overdue'
              : 'pressure'
        : metric === 'action_completion'
          ? task.approvalStatus === TaskApprovalStatus.pending_approval
            ? 'pending_signoff'
            : task.status
          : 'attention';

  return {
    id: task.id,
    metric,
    title: task.title,
    signal,
    status: `${task.status}/${task.approvalStatus}`,
    priority: task.priority,
    severity: null,
    homeId: task.home?.id ?? null,
    homeName: task.home?.name ?? null,
    careGroupId: task.home?.careGroup?.id ?? null,
    careGroupName: task.home?.careGroup?.name ?? null,
    dueAt: task.dueDate ? task.dueDate.toISOString() : null,
    happenedAt: task.createdAt.toISOString(),
    referenceType: 'task',
    referenceId: task.id,
  };
}

function mapRiskAlertToDrilldownRow(alert: RiAlertDrilldownRow): RiDashboardDrilldownRow {
  return {
    id: alert.id,
    metric: 'safeguarding_risk',
    title: alert.title,
    signal: alert.type,
    status: alert.status,
    priority: null,
    severity: alert.severity,
    homeId: alert.home?.id ?? null,
    homeName: alert.home?.name ?? null,
    careGroupId: alert.home?.careGroup?.id ?? null,
    careGroupName: alert.home?.careGroup?.name ?? null,
    dueAt: null,
    happenedAt: alert.lastTriggeredAt.toISOString(),
    referenceType: 'risk_alert',
    referenceId: alert.id,
  };
}

export async function generateRiDashboard(
  actorUserId: string,
  query: RiDashboardQuery,
): Promise<RiDashboardReport> {
  const tenant = await requireTenantContext(actorUserId);
  const window = resolveRiWindow(query);
  await validateRiScope(tenant.tenantId, query);

  const taskWhere = buildRiTaskWhere(tenant.tenantId, query, window);
  const employeeWhere = buildRiEmployeeWhere(tenant.tenantId, query);
  const shiftWhere = buildRiShiftWhere(tenant.tenantId, query, window);
  const alertWhere = buildRiAlertWhere(tenant.tenantId, query, window);
  const now = new Date();

  const openAlertWhere: Prisma.SafeguardingRiskAlertWhereInput = {
    ...alertWhere,
    status: { in: OPEN_RISK_ALERT_STATUSES },
  };

  const [
    totalTasks,
    activeTasks,
    completedTasks,
    overdueTasks,
    pendingApprovals,
    rejectedApprovals,
    approvedApprovals,
    incidentTasks,
    highPriorityOpenTasks,
    unassignedActiveTasks,
    activeEmployees,
    scheduledShifts,
    openRiskAlerts,
    openAlertsCritical,
    openAlertsHigh,
    openAlertsMedium,
    activeByHome,
    overdueByHome,
    pendingByHome,
    rejectedByHome,
    openAlertsByHome,
  ] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.task.count({ where: { ...taskWhere, status: { in: ACTIVE_TASK_STATUSES } } }),
    prisma.task.count({ where: { ...taskWhere, status: TaskStatus.completed } }),
    prisma.task.count({
      where: {
        ...taskWhere,
        status: { in: ACTIVE_TASK_STATUSES },
        dueDate: { lt: now },
      },
    }),
    prisma.task.count({
      where: { ...taskWhere, approvalStatus: TaskApprovalStatus.pending_approval },
    }),
    prisma.task.count({
      where: { ...taskWhere, approvalStatus: TaskApprovalStatus.rejected },
    }),
    prisma.task.count({
      where: { ...taskWhere, approvalStatus: TaskApprovalStatus.approved },
    }),
    prisma.task.count({ where: { ...taskWhere, category: TaskCategory.incident } }),
    prisma.task.count({
      where: {
        ...taskWhere,
        status: { in: ACTIVE_TASK_STATUSES },
        priority: { in: HIGH_PRIORITY_TASKS },
      },
    }),
    prisma.task.count({
      where: {
        ...taskWhere,
        status: { in: ACTIVE_TASK_STATUSES },
        assigneeId: null,
      },
    }),
    prisma.employee.count({ where: employeeWhere }),
    prisma.employeeShift.count({ where: shiftWhere }),
    prisma.safeguardingRiskAlert.count({ where: openAlertWhere }),
    prisma.safeguardingRiskAlert.count({
      where: {
        ...openAlertWhere,
        severity: SafeguardingRiskAlertSeverity.critical,
      },
    }),
    prisma.safeguardingRiskAlert.count({
      where: {
        ...openAlertWhere,
        severity: SafeguardingRiskAlertSeverity.high,
      },
    }),
    prisma.safeguardingRiskAlert.count({
      where: {
        ...openAlertWhere,
        severity: SafeguardingRiskAlertSeverity.medium,
      },
    }),
    prisma.task.groupBy({
      by: ['homeId'],
      where: {
        AND: [
          taskWhere,
          { homeId: { not: null } },
          { status: { in: ACTIVE_TASK_STATUSES } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['homeId'],
      where: {
        AND: [
          taskWhere,
          { homeId: { not: null } },
          { status: { in: ACTIVE_TASK_STATUSES } },
          { dueDate: { lt: now } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['homeId'],
      where: {
        AND: [
          taskWhere,
          { homeId: { not: null } },
          { approvalStatus: TaskApprovalStatus.pending_approval },
        ],
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['homeId'],
      where: {
        AND: [
          taskWhere,
          { homeId: { not: null } },
          { approvalStatus: TaskApprovalStatus.rejected },
        ],
      },
      _count: { _all: true },
    }),
    prisma.safeguardingRiskAlert.groupBy({
      by: ['homeId', 'severity'],
      where: {
        AND: [
          openAlertWhere,
          { homeId: { not: null } },
        ],
      },
      _count: { _all: true },
    }),
  ]);

  const complianceScore = clampScore(100 - pendingApprovals * 2 - rejectedApprovals * 8 - overdueTasks * 3);
  const safeguardingRiskScore = clampScore(
    100 - openAlertsCritical * 20 - openAlertsHigh * 12 - openAlertsMedium * 6 - incidentTasks * 2,
  );
  const staffingScore = clampScore(
    100 -
      unassignedActiveTasks * 4 -
      highPriorityOpenTasks * 3 -
      Math.max(0, activeTasks - Math.max(1, activeEmployees) * 4) * 2 -
      Math.max(0, activeEmployees - scheduledShifts) * 2,
  );

  const actionBase = completedTasks + activeTasks;
  const completionRate = actionBase === 0 ? 1 : completedTasks / actionBase;
  const actionCompletionScore = clampScore(
    completionRate * 100 - pendingApprovals * 2 - rejectedApprovals * 2 - overdueTasks,
  );

  const homeSignalMap = new Map<
    string,
    {
      activeTasks: number;
      overdueTasks: number;
      pendingApprovals: number;
      rejectedApprovals: number;
      openAlertsCritical: number;
      openAlertsHigh: number;
      openAlertsMedium: number;
    }
  >();

  const ensureHomeSignals = (homeId: string) => {
    const current = homeSignalMap.get(homeId);
    if (current) return current;
    const next = {
      activeTasks: 0,
      overdueTasks: 0,
      pendingApprovals: 0,
      rejectedApprovals: 0,
      openAlertsCritical: 0,
      openAlertsHigh: 0,
      openAlertsMedium: 0,
    };
    homeSignalMap.set(homeId, next);
    return next;
  };

  for (const row of activeByHome) {
    if (!row.homeId) continue;
    ensureHomeSignals(row.homeId).activeTasks = row._count._all;
  }
  for (const row of overdueByHome) {
    if (!row.homeId) continue;
    ensureHomeSignals(row.homeId).overdueTasks = row._count._all;
  }
  for (const row of pendingByHome) {
    if (!row.homeId) continue;
    ensureHomeSignals(row.homeId).pendingApprovals = row._count._all;
  }
  for (const row of rejectedByHome) {
    if (!row.homeId) continue;
    ensureHomeSignals(row.homeId).rejectedApprovals = row._count._all;
  }
  for (const row of openAlertsByHome) {
    if (!row.homeId) continue;
    const homeSignals = ensureHomeSignals(row.homeId);
    if (row.severity === SafeguardingRiskAlertSeverity.critical) {
      homeSignals.openAlertsCritical += row._count._all;
    } else if (row.severity === SafeguardingRiskAlertSeverity.high) {
      homeSignals.openAlertsHigh += row._count._all;
    } else {
      homeSignals.openAlertsMedium += row._count._all;
    }
  }

  const riskHomeIds = Array.from(homeSignalMap.keys());
  const homes =
    riskHomeIds.length > 0
      ? await prisma.home.findMany({
          where: {
            tenantId: tenant.tenantId,
            id: { in: riskHomeIds },
          },
          select: {
            id: true,
            name: true,
            careGroup: { select: { id: true, name: true } },
          },
        })
      : [];
  const homeById = new Map(homes.map((home) => [home.id, home]));

  const atRiskHomes = Array.from(homeSignalMap.entries())
    .map(([homeId, signals]) => {
      const home = homeById.get(homeId);
      const riskScore =
        signals.activeTasks +
        signals.overdueTasks * 4 +
        signals.pendingApprovals * 2 +
        signals.rejectedApprovals * 5 +
        signals.openAlertsMedium * 3 +
        signals.openAlertsHigh * 5 +
        signals.openAlertsCritical * 8;
      return {
        homeId,
        homeName: home?.name ?? 'Unknown home',
        careGroupId: home?.careGroup?.id ?? null,
        careGroupName: home?.careGroup?.name ?? null,
        riskScore,
        signals,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);

  const highlights: string[] = [];
  if (openAlertsCritical > 0) {
    highlights.push(`${openAlertsCritical} critical safeguarding alert(s) need immediate RI attention.`);
  }
  if (rejectedApprovals > 0) {
    highlights.push(`${rejectedApprovals} rejected approval item(s) are unresolved.`);
  }
  if (overdueTasks > 0) {
    highlights.push(`${overdueTasks} active task(s) are overdue in the selected period.`);
  }
  if (unassignedActiveTasks > 0) {
    highlights.push(`${unassignedActiveTasks} active task(s) are currently unassigned.`);
  }
  if (highlights.length === 0) {
    highlights.push('No immediate RI escalations detected in the selected scope.');
  }

  const scope = buildRiScope(tenant.tenantId, query, window);
  const response: RiDashboardReport = {
    generatedAt: new Date().toISOString(),
    scope,
    kpis: {
      compliance: {
        score: complianceScore,
        level: metricLevelFromScore(complianceScore),
        pendingApprovals,
        rejectedApprovals,
        overdueTasks,
      },
      safeguardingRisk: {
        score: safeguardingRiskScore,
        level: metricLevelFromScore(safeguardingRiskScore),
        incidentTasks,
        openAlerts: {
          total: openRiskAlerts,
          critical: openAlertsCritical,
          high: openAlertsHigh,
          medium: openAlertsMedium,
        },
      },
      staffingPressure: {
        score: staffingScore,
        level: metricLevelFromScore(staffingScore),
        activeEmployees,
        scheduledShifts,
        unassignedActiveTasks,
        highPriorityOpenTasks,
      },
      actionCompletion: {
        score: actionCompletionScore,
        level: metricLevelFromScore(actionCompletionScore),
        completionRate: Number(completionRate.toFixed(4)),
        completedTasks,
        activeTasks,
        approvalsClosed: approvedApprovals + rejectedApprovals,
        approvalsPending: pendingApprovals,
      },
    },
    totals: {
      totalTasks,
      activeTasks,
      completedTasks,
      overdueTasks,
      pendingApprovals,
      rejectedApprovals,
      approvedApprovals,
      incidentTasks,
      openRiskAlerts,
      activeEmployees,
      scheduledShifts,
    },
    highlights,
    atRiskHomes,
  };

  await logRiDashboardAccess({
    tenantId: tenant.tenantId,
    userId: actorUserId,
    entityType: 'ri_dashboard_overview',
    metadata: {
      scope,
      totalTasks,
      openRiskAlerts,
      atRiskHomes: atRiskHomes.length,
    },
  });

  return response;
}

export async function generateRiDashboardDrilldown(
  actorUserId: string,
  query: RiDashboardDrilldownQuery,
): Promise<RiDashboardDrilldownReport> {
  const tenant = await requireTenantContext(actorUserId);
  const window = resolveRiWindow(query);
  await validateRiScope(tenant.tenantId, query);

  const scope = buildRiScope(tenant.tenantId, query, window);
  const page = query.page;
  const pageSize = query.pageSize;
  const skip = (page - 1) * pageSize;
  const taskWhere = buildRiTaskWhere(tenant.tenantId, query, window);
  const alertWhere = buildRiAlertWhere(tenant.tenantId, query, window);
  const now = new Date();

  let total = 0;
  let data: RiDashboardDrilldownRow[] = [];

  if (query.metric === 'safeguarding_risk') {
    const where: Prisma.SafeguardingRiskAlertWhereInput = {
      ...alertWhere,
      status: { in: OPEN_RISK_ALERT_STATUSES },
    };
    const [count, alerts] = await Promise.all([
      prisma.safeguardingRiskAlert.count({ where }),
      prisma.safeguardingRiskAlert.findMany({
        where,
        orderBy: [{ lastTriggeredAt: 'desc' }],
        skip,
        take: pageSize,
        select: RI_DRILLDOWN_ALERT_SELECT,
      }),
    ]);
    total = count;
    data = alerts.map(mapRiskAlertToDrilldownRow);
  } else {
    let where: Prisma.TaskWhereInput;
    if (query.metric === 'compliance') {
      where = {
        ...taskWhere,
        OR: [
          { approvalStatus: TaskApprovalStatus.pending_approval },
          { approvalStatus: TaskApprovalStatus.rejected },
          {
            AND: [
              { status: { in: ACTIVE_TASK_STATUSES } },
              { dueDate: { lt: now } },
            ],
          },
        ],
      };
    } else if (query.metric === 'staffing_pressure') {
      where = {
        ...taskWhere,
        OR: [
          {
            AND: [
              { status: { in: ACTIVE_TASK_STATUSES } },
              { assigneeId: null },
            ],
          },
          {
            AND: [
              { status: { in: ACTIVE_TASK_STATUSES } },
              { priority: { in: HIGH_PRIORITY_TASKS } },
            ],
          },
          {
            AND: [
              { status: { in: ACTIVE_TASK_STATUSES } },
              { dueDate: { lt: now } },
            ],
          },
        ],
      };
    } else {
      where = {
        ...taskWhere,
        OR: [
          { status: { in: ACTIVE_TASK_STATUSES } },
          { approvalStatus: TaskApprovalStatus.pending_approval },
        ],
      };
    }

    const [count, tasks] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        select: RI_DRILLDOWN_TASK_SELECT,
      }),
    ]);
    total = count;
    data = tasks.map((task) => mapTaskToDrilldownRow(query.metric, task, now));
  }

  const response: RiDashboardDrilldownReport = {
    generatedAt: new Date().toISOString(),
    scope,
    metric: query.metric,
    data,
    meta: buildPaginationMeta(total, page, pageSize),
  };

  await logRiDashboardAccess({
    tenantId: tenant.tenantId,
    userId: actorUserId,
    entityType: 'ri_dashboard_drilldown',
    metadata: {
      scope,
      metric: query.metric,
      page,
      pageSize,
      total,
    },
  });

  return response;
}

export function toRiDashboardOverviewExport(report: RiDashboardReport): EvidencePackExport {
  const columns: ExportColumn[] = [
    { header: 'Section', key: 'section', width: 150 },
    { header: 'Metric', key: 'metric', width: 220 },
    { header: 'Value', key: 'value', width: 120 },
    { header: 'Level', key: 'level', width: 90 },
    { header: 'Notes', key: 'notes', width: 280 },
  ];

  const rows: Record<string, unknown>[] = [
    {
      section: 'KPI',
      metric: 'Compliance score',
      value: report.kpis.compliance.score,
      level: report.kpis.compliance.level,
      notes: `Pending approvals: ${report.kpis.compliance.pendingApprovals}; rejected: ${report.kpis.compliance.rejectedApprovals}; overdue: ${report.kpis.compliance.overdueTasks}`,
    },
    {
      section: 'KPI',
      metric: 'Safeguarding risk score',
      value: report.kpis.safeguardingRisk.score,
      level: report.kpis.safeguardingRisk.level,
      notes: `Open alerts (C/H/M): ${report.kpis.safeguardingRisk.openAlerts.critical}/${report.kpis.safeguardingRisk.openAlerts.high}/${report.kpis.safeguardingRisk.openAlerts.medium}`,
    },
    {
      section: 'KPI',
      metric: 'Staffing pressure score',
      value: report.kpis.staffingPressure.score,
      level: report.kpis.staffingPressure.level,
      notes: `Unassigned active tasks: ${report.kpis.staffingPressure.unassignedActiveTasks}; high-priority open tasks: ${report.kpis.staffingPressure.highPriorityOpenTasks}`,
    },
    {
      section: 'KPI',
      metric: 'Action completion score',
      value: report.kpis.actionCompletion.score,
      level: report.kpis.actionCompletion.level,
      notes: `Completion rate: ${(report.kpis.actionCompletion.completionRate * 100).toFixed(1)}%; approvals pending: ${report.kpis.actionCompletion.approvalsPending}`,
    },
  ];

  report.highlights.forEach((highlight) => {
    rows.push({
      section: 'Highlight',
      metric: 'Priority signal',
      value: '',
      level: '',
      notes: highlight,
    });
  });

  report.atRiskHomes.forEach((home) => {
    rows.push({
      section: 'At-risk homes',
      metric: home.homeName,
      value: home.riskScore,
      level: '',
      notes: `Overdue:${home.signals.overdueTasks}, Pending:${home.signals.pendingApprovals}, Rejected:${home.signals.rejectedApprovals}, Alerts(C/H/M):${home.signals.openAlertsCritical}/${home.signals.openAlertsHigh}/${home.signals.openAlertsMedium}`,
    });
  });

  const subtitle = `${report.scope.dateFrom.slice(0, 10)} to ${report.scope.dateTo.slice(0, 10)}${report.scope.homeId ? ` • home:${report.scope.homeId}` : ''}${report.scope.careGroupId ? ` • careGroup:${report.scope.careGroupId}` : ''}`;
  return {
    title: 'RI Monitoring Dashboard',
    subtitle,
    columns,
    rows,
  };
}

export function toRiDashboardDrilldownExport(report: RiDashboardDrilldownReport): EvidencePackExport {
  const columns: ExportColumn[] = [
    { header: 'Metric', key: 'metric', width: 150 },
    { header: 'Title', key: 'title', width: 260 },
    { header: 'Signal', key: 'signal', width: 160 },
    { header: 'Status', key: 'status', width: 140 },
    { header: 'Severity', key: 'severity', width: 110 },
    { header: 'Priority', key: 'priority', width: 100 },
    { header: 'Home', key: 'homeName', width: 180 },
    { header: 'Care Group', key: 'careGroupName', width: 180 },
    { header: 'Due At', key: 'dueAt', width: 160 },
    { header: 'Occurred At', key: 'happenedAt', width: 160 },
    { header: 'Reference', key: 'referenceId', width: 170 },
  ];

  const rows = report.data.map((row) => ({
    metric: row.metric,
    title: row.title,
    signal: row.signal,
    status: row.status,
    severity: row.severity ?? '',
    priority: row.priority ?? '',
    homeName: row.homeName ?? '',
    careGroupName: row.careGroupName ?? '',
    dueAt: row.dueAt ?? '',
    happenedAt: row.happenedAt,
    referenceId: row.referenceId,
  }));

  const subtitle =
    `${report.scope.dateFrom.slice(0, 10)} to ${report.scope.dateTo.slice(0, 10)} • metric:${report.metric}` +
    `${report.scope.homeId ? ` • home:${report.scope.homeId}` : ''}` +
    `${report.scope.careGroupId ? ` • careGroup:${report.scope.careGroupId}` : ''}`;

  return {
    title: 'RI Monitoring Drilldown',
    subtitle,
    columns,
    rows,
  };
}
