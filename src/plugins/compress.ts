import fp from 'fastify-plugin';
import compress from '@fastify/compress';

export default fp(
  async (fastify) => {
    await fastify.register(compress, {
      // Compress all responses above 1 KB.
      threshold: 1024,
      // Prefer brotli if the client supports it; fall back to gzip.
      encodings: ['br', 'gzip', 'deflate', 'identity'],
    });
  },
  { name: 'compress' },
);
