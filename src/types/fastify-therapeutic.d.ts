import 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    therapeuticModule?:
      | 'reg_packs'
      | 'chronology'
      | 'risk_alerts'
      | 'patterns'
      | 'ri_dashboard'
      | 'reflective_prompts';
    therapeuticAction?: string;
    therapeuticActionCompletion?: boolean;
  }
}

export {};
