import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { getUserFromRequest } from '@imports/auth/getUser';
import { logger } from '@imports/utils/logger';
import { getMetasByDocument } from '@imports/metas-by-document';

const metasByDocumentApi: FastifyPluginCallback = async (fastify, _, done) => {
	fastify.get<{ Params: { document: string } }>('/api/metas/:document', async (req, reply) => {
		if (req.originalUrl == null || req.params == null) {
			return reply.status(404).send('Not found');
		}

		const document = req.params.document;

		if (document == null) {
			return reply.status(400).send('Bad request');
		}

		try {
			const user = await getUserFromRequest(req);

			if (user == null) {
				return reply.status(401).send('Unauthorized');
			}

			const result = await getMetasByDocument(document);

			if (result == null) {
				return reply.status(404).send('Invalid meta object');
			}

			return reply.send(result);
		} catch (error) {
			if (/^\[get-user\]/.test((error as Error).message)) {
				return reply.status(401).send('Unauthorized');
			}

			logger.error(error, `Error getting metas for ${document}`);
			return reply.status(500).send('Internal server error');
		}
	});

	done();
};

export default fp(metasByDocumentApi);
