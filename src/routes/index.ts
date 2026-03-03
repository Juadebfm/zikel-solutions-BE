import type { FastifyPluginAsync } from 'fastify';
import healthRoutes from './health.js';

// Import feature route modules as they are implemented, e.g.:
// import authRoutes from '../modules/auth/auth.routes.js';

const rootRouter: FastifyPluginAsync = async (fastify) => {
  await fastify.register(healthRoutes);

  // v1 API prefix
  await fastify.register(
    async (v1) => {
      // await v1.register(authRoutes, { prefix: '/auth' });
      // await v1.register(careGroupRoutes, { prefix: '/care-groups' });
      // ... additional modules registered here as built
    },
    { prefix: '/api/v1' },
  );
};

export default rootRouter;
