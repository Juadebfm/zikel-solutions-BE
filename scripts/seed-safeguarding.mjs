import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TENANT = 'mig_legacy_tenant';

async function run() {
  // Get homes and young people
  const homes = await pool.query(`SELECT id, name FROM "Home" WHERE "tenantId" = $1 ORDER BY name`, [TENANT]);
  const yps = await pool.query(`SELECT id, "firstName", "lastName", "homeId" FROM "YoungPerson" WHERE "tenantId" = $1`, [TENANT]);
  const users = await pool.query(`SELECT id FROM "User" WHERE "activeTenantId" = $1 LIMIT 1`, [TENANT]);
  const emps = await pool.query(`SELECT id FROM "Employee" WHERE "tenantId" = $1`, [TENANT]);

  const h = homes.rows;
  const yp = yps.rows;
  const userId = users.rows[0]?.id;
  const empId = emps.rows[0]?.id;

  console.log(`Homes: ${h.length}, YP: ${yp.length}, User: ${userId}`);
  if (!h.length || !yp.length || !userId) { console.log('Missing data'); await pool.end(); return; }

  const now = new Date();
  const daysAgo = (d) => new Date(now.getTime() - d * 86400000);

  // ─── 1. Incident Tasks (for chronology + patterns) ─────────────────────
  const incidents = [
    { title: 'Absconding Incident — left premises without permission', yp: 0, home: 0, days: 2, priority: 'urgent', desc: 'Young person left the home at 22:30 without staff knowledge. Police contacted. Found safe at local park at 23:15. Trigger: argument with peer about TV remote. De-escalation attempted prior.' },
    { title: 'Self-harm concern — superficial scratches on forearm', yp: 1, home: 1, days: 5, priority: 'high', desc: 'Staff noticed superficial scratches during personal care. Young person disclosed feeling overwhelmed by school. CAMHS referral discussed. Trigger: exam stress. Safety plan reviewed.' },
    { title: 'Physical aggression towards staff member', yp: 2, home: 0, days: 8, priority: 'urgent', desc: 'Young person became dysregulated after being asked to tidy room. Threw objects and struck staff on arm. PRICE restraint used for 3 minutes. No injuries sustained. Trigger: directive instruction. De-escalation: offered break, low tone.' },
    { title: 'Missing from home — failed to return from school', yp: 0, home: 0, days: 12, priority: 'urgent', desc: 'Young person did not return from school at expected time (15:30). Located at friend house at 17:00 via phone contact. Police not called. Trigger: wanted to stay at friend house.' },
    { title: 'Verbal aggression and property damage', yp: 3, home: 1, days: 15, priority: 'high', desc: 'Young person shouted profanities at staff and kicked bedroom door causing damage. Trigger: denied phone access due to late hour. Calmed after 20 minutes with keyworker support.' },
    { title: 'Medication refusal — evening medication', yp: 1, home: 1, days: 3, priority: 'medium', desc: 'Young person refused prescribed evening medication. Stated feeling nauseous. GP to be contacted. Previous refusal noted 5 days ago.' },
    { title: 'Peer conflict — verbal altercation at dinner', yp: 2, home: 0, days: 7, priority: 'medium', desc: 'Two young people argued during dinner about seating. Staff intervened. Both calmed within 10 minutes. No physical contact. Restorative conversation held after.' },
    { title: 'Absconding attempt — intercepted at front door', yp: 0, home: 0, days: 1, priority: 'high', desc: 'Young person attempted to leave at 01:00. Night staff intercepted at front door. Young person was upset about a phone call with parent earlier. Keyworker session arranged for morning.' },
    { title: 'Safeguarding disclosure — historical abuse', yp: 4, home: 1, days: 20, priority: 'urgent', desc: 'Young person disclosed historical physical abuse during keyworker session. Logged and referred to social worker. LADO consulted. Child appeared relieved after disclosure.' },
    { title: 'Self-regulation difficulty — bedroom barricade', yp: 3, home: 1, days: 10, priority: 'high', desc: 'Young person barricaded bedroom door with furniture. Staff maintained calm presence outside door. Young person emerged after 45 minutes. Trigger: disagreement with peer. No self-harm.' },
    { title: 'Police involvement — criminal damage in community', yp: 0, home: 0, days: 25, priority: 'urgent', desc: 'Young person involved in criminal damage incident at local shop. Police attended and issued warning. Restorative justice meeting planned. Social worker informed.' },
    { title: 'Medication error — double dose administered', yp: 1, home: 1, days: 18, priority: 'urgent', desc: 'Staff administered evening dose without checking MAR chart. Previous dose already given. GP contacted immediately. Young person monitored overnight. No adverse effects. Incident reported to RIDDOR.' },
  ];

  let created = 0;
  for (const inc of incidents) {
    const ypRow = yp[inc.yp % yp.length];
    const homeRow = h[inc.home % h.length];
    const d = daysAgo(inc.days);
    await pool.query(`
      INSERT INTO "Task" (id, "tenantId", title, description, category, status, "approvalStatus", priority, "homeId", "youngPersonId", "createdById", "submittedAt", "dueDate", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), $1, $2, $3, 'incident', 'completed', 'approved', $4, $5, $6, $7, $8, $8, $8, $8)
    `, [TENANT, inc.title, inc.desc, inc.priority, homeRow.id, ypRow.id, userId, d]);
    created++;
  }
  console.log(`Created ${created} incident tasks`);

  // ─── 2. Home Events (for chronology) ───────────────────────────────────
  const events = [
    { title: 'Emergency fire drill', type: 'other', home: 0, days: 4, desc: 'Unannounced fire drill at 14:00. All residents evacuated in 2 minutes 45 seconds. Assembly point: front garden. All accounted for.' },
    { title: 'Ofsted inspector visit', type: 'appointment', home: 0, days: 14, desc: 'Scheduled Ofsted monitoring visit. Inspector reviewed records, spoke with young people and staff. No concerns raised.' },
    { title: 'Missing person protocol activated', type: 'other', home: 0, days: 2, desc: 'Missing person protocol activated for YP at 22:45. Police informed. YP located safe at 23:15.' },
    { title: 'Police attendance — welfare check', type: 'other', home: 1, days: 6, desc: 'Police attended for welfare check following referral from school. No further action required.' },
    { title: 'Social worker statutory visit', type: 'appointment', home: 1, days: 9, desc: 'Statutory 6-week visit by allocated social worker. Private meeting with young person. Care plan reviewed.' },
    { title: 'Injury report — staff member', type: 'other', home: 0, days: 8, desc: 'Staff member sustained minor bruise to forearm during physical intervention. First aid administered. RIDDOR form completed.' },
    { title: 'Medication audit — pharmacy visit', type: 'appointment', home: 1, days: 22, desc: 'Quarterly medication audit by community pharmacist. All MAR charts reviewed. Two minor recording gaps identified and corrected.' },
    { title: 'Family contact session', type: 'meeting', home: 0, days: 3, desc: 'Supervised family contact session. Parent visited for 2 hours. Positive interaction observed. Next session in 2 weeks.' },
    { title: 'Emergency maintenance — boiler failure', type: 'other', home: 1, days: 16, desc: 'Boiler failed at 06:00. Emergency engineer called. Temporary heating provided. Repaired by 14:00.' },
    { title: 'Reg 44 independent visitor', type: 'appointment', home: 0, days: 30, desc: 'Monthly Reg 44 visit. Visitor spoke with 3 young people and 2 staff. Report to follow within 5 working days.' },
  ];

  let evtCreated = 0;
  for (const evt of events) {
    const homeRow = h[evt.home % h.length];
    const d = daysAgo(evt.days);
    await pool.query(`
      INSERT INTO "HomeEvent" (id, "tenantId", "homeId", title, description, type, "startsAt", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $6, $6)
    `, [TENANT, homeRow.id, evt.title, evt.desc, evt.type, d]);
    evtCreated++;
  }
  console.log(`Created ${evtCreated} home events`);

  // ─── 3. Risk Alerts ────────────────────────────────────────────────────
  const alerts = [
    {
      type: 'repeated_incident_pattern', severity: 'high', status: 'new',
      targetType: 'young_person', targetId: yp[0].id, homeId: h[0].id, youngPersonId: yp[0].id,
      title: `Repeated absconding — ${yp[0].firstName} ${yp[0].lastName}`,
      desc: '3 absconding incidents in 14 days. Pattern suggests escalation linked to evening routine and peer conflict.',
      ruleKey: 'repeated_incident_pattern', dedupeKey: `absconding_${yp[0].id}_recent`,
      evidence: { incidentCount: 3, windowDays: 14, triggers: ['peer conflict', 'evening routine'], trend: 'escalating' },
      days: 1,
    },
    {
      type: 'high_severity_incident', severity: 'critical', status: 'acknowledged',
      targetType: 'young_person', targetId: yp[4 % yp.length].id, homeId: h[1 % h.length].id, youngPersonId: yp[4 % yp.length].id,
      title: `Safeguarding disclosure — ${yp[4 % yp.length].firstName} ${yp[4 % yp.length].lastName}`,
      desc: 'Historical abuse disclosure. LADO consulted. Social worker and police informed. Ongoing investigation.',
      ruleKey: 'high_severity_incident', dedupeKey: `disclosure_${yp[4 % yp.length].id}_recent`,
      evidence: { incidentType: 'disclosure', referrals: ['LADO', 'social_worker', 'police'], status: 'under_investigation' },
      days: 20,
    },
    {
      type: 'overdue_high_priority_tasks', severity: 'medium', status: 'in_progress',
      targetType: 'home', targetId: h[0].id, homeId: h[0].id, youngPersonId: null,
      title: `Overdue high-priority tasks — ${h[0].name}`,
      desc: '4 high-priority tasks overdue by more than 48 hours. Includes medication review and incident follow-up.',
      ruleKey: 'overdue_high_priority_tasks', dedupeKey: `overdue_${h[0].id}_recent`,
      evidence: { overdueCount: 4, categories: ['medication', 'incident_followup'], oldestOverdueDays: 5 },
      days: 3,
    },
    {
      type: 'critical_home_event_signal', severity: 'high', status: 'resolved',
      targetType: 'home', targetId: h[1 % h.length].id, homeId: h[1 % h.length].id, youngPersonId: null,
      title: `Police involvement — ${h[1 % h.length].name}`,
      desc: 'Police attended home for welfare check. No further action required. Reviewed and closed.',
      ruleKey: 'critical_home_event_signal', dedupeKey: `police_${h[1 % h.length].id}_recent`,
      evidence: { eventType: 'police_attendance', outcome: 'no_further_action' },
      days: 6,
    },
    {
      type: 'rejected_approval_spike', severity: 'medium', status: 'new',
      targetType: 'home', targetId: h[0].id, homeId: h[0].id, youngPersonId: null,
      title: `Approval rejection spike — ${h[0].name}`,
      desc: '5 task approvals rejected in 7 days. May indicate training gap or documentation quality issues.',
      ruleKey: 'rejected_approval_spike', dedupeKey: `rejections_${h[0].id}_recent`,
      evidence: { rejectedCount: 5, windowDays: 7, categories: ['daily_log', 'incident_report'] },
      days: 4,
    },
  ];

  let alertCreated = 0;
  for (const a of alerts) {
    const d = daysAgo(a.days);
    const resolvedAt = a.status === 'resolved' ? d : null;
    const acknowledgedAt = (a.status === 'acknowledged' || a.status === 'in_progress' || a.status === 'resolved') ? d : null;
    await pool.query(`
      INSERT INTO "SafeguardingRiskAlert" (id, "tenantId", type, severity, status, "targetType", "targetId", "homeId", "youngPersonId", "ruleKey", "dedupeKey", title, description, evidence, "windowStart", "windowEnd", "firstTriggeredAt", "lastTriggeredAt", "triggeredCount", "ownerUserId", "acknowledgedAt", "resolvedAt", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $14, $14, 1, $16, $17, $18, $14, $14)
    `, [TENANT, a.type, a.severity, a.status, a.targetType, a.targetId, a.homeId, a.youngPersonId, a.ruleKey, a.dedupeKey, a.title, a.desc, JSON.stringify(a.evidence), d, daysAgo(a.days + 14), userId, acknowledgedAt, resolvedAt]);
    alertCreated++;
  }
  console.log(`Created ${alertCreated} risk alerts`);

  // ─── 4. Risk Alert Notes ───────────────────────────────────────────────
  const alertIds = await pool.query(`SELECT id, title, status FROM "SafeguardingRiskAlert" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC`, [TENANT]);

  for (const alert of alertIds.rows) {
    if (alert.status === 'acknowledged' || alert.status === 'in_progress' || alert.status === 'resolved') {
      await pool.query(`
        INSERT INTO "SafeguardingRiskAlertNote" (id, "alertId", "tenantId", "userId", note, "isEscalation", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
      `, [alert.id, TENANT, userId, `Reviewed and assessed. ${alert.status === 'resolved' ? 'No further action required. Closed.' : 'Monitoring continues.'}`, false]);
    }
  }
  console.log('Created alert notes');

  // Final counts
  const taskCount = await pool.query(`SELECT COUNT(*) FROM "Task" WHERE "tenantId" = $1 AND category = 'incident'`, [TENANT]);
  const eventCount = await pool.query(`SELECT COUNT(*) FROM "HomeEvent" WHERE "tenantId" = $1`, [TENANT]);
  const alertCount = await pool.query(`SELECT COUNT(*) FROM "SafeguardingRiskAlert" WHERE "tenantId" = $1`, [TENANT]);
  const noteCount = await pool.query(`SELECT COUNT(*) FROM "SafeguardingRiskAlertNote" WHERE "tenantId" = $1`, [TENANT]);

  console.log(`\nFinal counts:`);
  console.log(`  Incident tasks: ${taskCount.rows[0].count}`);
  console.log(`  Home events: ${eventCount.rows[0].count}`);
  console.log(`  Risk alerts: ${alertCount.rows[0].count}`);
  console.log(`  Alert notes: ${noteCount.rows[0].count}`);

  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
