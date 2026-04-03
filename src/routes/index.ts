import type { FastifyPluginAsync } from 'fastify';
import healthRoutes from './health.js';
import authRoutes from '../modules/auth/auth.routes.js';
import meRoutes from '../modules/me/me.routes.js';
import publicRoutes from '../modules/public/public.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import announcementsRoutes from '../modules/announcements/announcements.routes.js';
import summaryRoutes from '../modules/summary/summary.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import tenantRoutes from '../modules/tenants/tenants.routes.js';
import careGroupRoutes from '../modules/care-groups/care-groups.routes.js';
import homeRoutes from '../modules/homes/homes.routes.js';
import employeeRoutes from '../modules/employees/employees.routes.js';
import youngPeopleRoutes from '../modules/young-people/young-people.routes.js';
import vehicleRoutes from '../modules/vehicles/vehicles.routes.js';
import taskRoutes from '../modules/tasks/tasks.routes.js';
import formsRoutes from '../modules/forms/forms.routes.js';
import uploadsRoutes from '../modules/uploads/uploads.routes.js';
import dailyLogRoutes from '../modules/daily-logs/daily-logs.routes.js';
import roleRoutes from '../modules/roles/roles.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import integrationsRoutes from '../modules/integrations/integrations.routes.js';
import helpCenterRoutes from '../modules/help-center/help-center.routes.js';
import notificationsRoutes from '../modules/notifications/notifications.routes.js';
import webhooksRoutes from '../modules/webhooks/webhooks.routes.js';
import reportsRoutes from '../modules/reports/reports.routes.js';
import safeguardingRoutes from '../modules/safeguarding/safeguarding.routes.js';

const rootRouter: FastifyPluginAsync = async (fastify) => {
  // Infrastructure probes — no auth, no /api/v1 prefix
  await fastify.register(healthRoutes);

  // v1 API
  await fastify.register(
    async (v1) => {
      await v1.register(authRoutes, { prefix: '/auth' });
      await v1.register(meRoutes, { prefix: '/me' });
      await v1.register(publicRoutes, { prefix: '/public' });
      await v1.register(aiRoutes, { prefix: '/ai' });
      await v1.register(announcementsRoutes, { prefix: '/announcements' });
      await v1.register(summaryRoutes, { prefix: '/summary' });
      await v1.register(dashboardRoutes, { prefix: '/dashboard' });
      await v1.register(tenantRoutes, { prefix: '/tenants' });
      await v1.register(careGroupRoutes, { prefix: '/care-groups' });
      await v1.register(homeRoutes, { prefix: '/homes' });
      await v1.register(employeeRoutes, { prefix: '/employees' });
      await v1.register(youngPeopleRoutes, { prefix: '/young-people' });
      await v1.register(vehicleRoutes, { prefix: '/vehicles' });
      await v1.register(taskRoutes, { prefix: '/tasks' });
      await v1.register(formsRoutes, { prefix: '/forms' });
      await v1.register(uploadsRoutes, { prefix: '/uploads' });
      await v1.register(dailyLogRoutes, { prefix: '/daily-logs' });
      await v1.register(roleRoutes, { prefix: '/roles' });
      await v1.register(auditRoutes, { prefix: '/audit' });
      await v1.register(integrationsRoutes, { prefix: '/integrations' });
      await v1.register(helpCenterRoutes, { prefix: '/help-center' });
      await v1.register(notificationsRoutes, { prefix: '/notifications' });
      await v1.register(webhooksRoutes, { prefix: '/webhooks' });
      await v1.register(reportsRoutes, { prefix: '/reports' });
      await v1.register(safeguardingRoutes, { prefix: '/safeguarding' });
    },
    { prefix: '/api/v1' },
  );
};

export default rootRouter;
