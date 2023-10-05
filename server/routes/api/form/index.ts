import { WebApp } from 'meteor/webapp';
import { match } from 'path-to-regexp';
import { getUserFromRequest } from '/imports/auth/getUser';
import { logger } from '/imports/utils/logger';
import { getDocumentForm } from '/imports/form';

WebApp.connectHandlers.use('/api/form', async (req, res) => {
	const matchPath = match<{ document?: string; id?: string }>('/api/form/:document/:id', { decode: decodeURIComponent });

	const urlParams = matchPath(req.originalUrl ?? '');

	if (req.originalUrl == null || urlParams === false) {
		res.writeHead(404);
		res.end('Not found');
		return;
	}

	const document = urlParams.params.document;
	const id = urlParams.params.id;

	if (document == null || id == null) {
		res.writeHead(400);
		res.end('Bad request');
		return;
	}

	try {
		const user = await getUserFromRequest(req);

		if (user == null) {
			res.writeHead(401);
			res.end('Unauthorized');
			return;
		}

		const result = await getDocumentForm(document, id);

		if (result == null) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}

		res.setHeader('Content-Type', 'application/json');
		res.writeHead(200);
		res.end(JSON.stringify(result, null, 2));
	} catch (error) {
		if (/^\[get-user\]/.test((error as Error).message)) {
			res.writeHead(401);
			res.end('Unauthorized');
			return;
		}
		logger.error(error, `Error getting form for ${document}/${id}}`);
		res.writeHead(500);
		res.end('Internal server error');
	}
});