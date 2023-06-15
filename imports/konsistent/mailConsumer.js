import { Meteor } from 'meteor/meteor';
import { SSR } from 'meteor/meteorhacks:ssr';

import path from 'path';
import { each } from 'async';
import { createTransport } from 'nodemailer';
import smtpTransport from 'nodemailer-smtp-transport';
import EmailTemplates from 'swig-email-templates';

import isObject from 'lodash/isObject';
import extend from 'lodash/extend';
import omit from 'lodash/omit';
import isEmpty from 'lodash/isEmpty';
import bind from 'lodash/bind';
import get from 'lodash/get';
import has from 'lodash/has';
import join from 'lodash/join';
import map from 'lodash/map';

import { logger } from '../utils/logger';
import { Models, MetaObject } from '/imports/model/MetaObject';

export const Templates = {};
const basePath = path.resolve('.').split('.meteor')[0];

let tplPath = 'imports/konsistent/templates/mail';

if (basePath.indexOf('bundle/programs/server') > 0) {
	tplPath = `../../programs/server/assets/${tplPath}`;
}

const emailTemplateOptions = {
	root: path.join(basePath, tplPath),
	filters: {
		upper: function (str) {
			return str.toUpperCase();
		},
	},
};

let namespace = undefined;

const transporters = {};

export const mailConsumer = {
	sendEmail(record, cb) {
		let user;
		let server = transporters.default;
		if (record.server) {
			if (transporters[record.server] == null) {
				server = transporters[record.server];
			} else {
				logger.error(`Server ${record.server} not found`);
			}
		} else {
			record.server = 'default';
		}

		if (isObject(get(namespace, 'emailServers')) && get(namespace, `emailServers.${record.server}.useUserCredentials`) === true) {
			user = Models['User'].findOne(record._user[0]._id, {
				fields: { name: 1, emails: 1, emailAuthLogin: 1, emailAuthPass: 1 },
			});
			logger.debug('IF -> user?.emailAuthLogin ->', get(user, 'emailAuthLogin'));
			if (has(user, 'emailAuthLogin')) {
				record.from = user.name + ' <' + get(user, 'emails.0.address') + '>';
				server = createTransport(
					extend({}, omit(namespace.emailServers[record.server], 'useUserCredentials'), {
						auth: { user: user.emailAuthLogin, pass: user.emailAuthPass },
					}),
				);
			}
		}

		if ((!record.to || isEmpty(record.to)) && record.email) {
			record.to = join(
				map(record.email, email => email.address),
				',',
			);
		}

		if ((!record.from || isEmpty(record.from)) && get(record, '_user.length', 0) > 0) {
			user = Models['User'].findOne(record._user[0]._id, { fields: { name: 1, emails: 1 } });

			record.from = user.name + ' <' + get(user, 'emails.0.address') + '>';
		}

		if (!record.to) {
			const err = { message: 'No address to send e-mail to.' };
			err.host = serverHost || record.server;
			Models['Message'].update({ _id: record._id }, { $set: { status: 'Falha no Envio', error: err } });
			logger.error(`📧 Email error: ${JSON.stringify(err, null, ' ')}`);
			return cb();
		} else {
			const mail = {
				from: record.from,
				to: record.to,
				subject: record.subject,
				html: record.body,
				replyTo: record.replyTo,
				cc: record.cc,
				bcc: record.bcc,
				attachments: record.attachments,
				headers: record.headers || [],
			};

			if (record.meta) {
				for (let name in record.meta) {
					const content = record.meta[name];
					mail.html += `<meta name='${name}' content='${content}'>`;
				}
			}

			if (process.env.KONECTY_MODE !== 'production') {
				mail.subject = `[DEV] [${mail.to}] ${mail.subject}`;
				mail.to = null; // 'team@konecty.com'
				mail.cc = null;
				mail.bcc = null;
			}

			if (mail.to) {
				if (server) {
					var serverHost = get(server, 'transporter.options.host');
					return server.sendMail(
						mail,
						Meteor.bindEnvironment(function (err, response) {
							if (err) {
								err.host = serverHost || record.server;
								Models['Message'].update({ _id: record._id }, { $set: { status: 'Falha no Envio', error: err } });
								logger.error(err, `📧 Email error: ${err.message}`);
								return cb();
							}

							if (get(response, 'accepted.length') > 0) {
								if (record.discard === true) {
									Models['Message'].remove({ _id: record._id });
								} else {
									Models['Message'].update({ _id: record._id }, { $set: { status: record.sentStatus || 'Enviada' } });
								}
								logger.info(`📧 Email sent to ${response.accepted.join(', ')} via [${serverHost || record.server}]`);
							}
							return cb();
						}),
					);
				} else {
					logger.error(`📧 There are no mail server configured, Email NOT sent`);
					return cb();
				}
			} else {
				return cb();
			}
		}
	},

	send(record, cb) {
		if (!record.template) {
			return mailConsumer.sendEmail(record, cb);
		}

		if (Templates[record.template]) {
			if (!record.subject) {
				record.subject = Templates[record.template].subject;
			}
			record.body = SSR.render(record.template, extend({ message: { _id: record._id } }, record.data));
			Models['Message'].update({ _id: record._id }, { $set: { body: record.body, subject: record.subject } });
			return mailConsumer.sendEmail(record, cb);
		}

		const emailTemplates = new EmailTemplates(emailTemplateOptions);
		if (!record.data) {
			record.data = {};
		}

		return emailTemplates.render(
			record.template,
			record.data,
			Meteor.bindEnvironment(function (err, html) {
				if (err) {
					Models['Message'].update({ _id: record._id }, { $set: { status: 'Falha no Envio', error: `${err}` } });
					logger.error(err, `📧 Email error: ${err.message}`);
					return cb();
				}
				record.body = html;
				return mailConsumer.sendEmail(record, cb);
			}),
		);
	},

	consume() {
		if (!Models['Message']) {
			return;
		}

		mailConsumer.lockedAt = Date.now();
		const collection = Models.Message._getCollection();
		const findOneAndUpdate = Meteor.wrapAsync(bind(collection.findOneAndUpdate, collection));

		const query = {
			type: 'Email',
			status: { $in: ['Enviando', 'Send'] },
			$or: [{ sendAt: { $exists: 0 } }, { sendAt: { $lt: new Date() } }],
		};
		const sort = [];
		const update = { $set: { status: 'A Caminho' } };
		const options = {
			new: true,
			limit: 10,
			sort,
		};

		const updatedRecords = findOneAndUpdate(query, update, options);
		const records = [];
		if (updatedRecords.value !== null) {
			records.push(updatedRecords.value);
		}

		if (records.length === 0) {
			setTimeout(Meteor.bindEnvironment(mailConsumer.consume), 1000);
			return;
		}

		return each(records, mailConsumer.send, () => mailConsumer.consume());
	},

	start() {
		logger.info('Starting mail consumer');
		namespace = MetaObject.findOne({ _id: 'Namespace' });

		if (isObject(get(namespace, 'emailServers'))) {
			for (let key in namespace.emailServers) {
				const value = namespace.emailServers[key];
				if (!value.useUserCredentials) {
					logger.info(`Setup email server [${key}]`);
					transporters[key] = createTransport(smtpTransport(value));
				}
			}
		}

		if (!transporters.default && process.env.DEFAULT_SMTP_HOST && process.env.DEFAULT_SMTP_PORT && process.env.DEFAULT_SMTP_USERNAME && process.env.DEFAULT_SMTP_PASSWORD) {
			const defaultSMTPConfig = {
				host: process.env.DEFAULT_SMTP_HOST,
				port: +process.env.DEFAULT_SMTP_PORT,
				auth: {
					user: process.env.DEFAULT_SMTP_USERNAME,
					pass: process.env.DEFAULT_SMTP_PASSWORD,
				},
			};

			if (process.env.DEFAULT_SMTP_SECURE) {
				defaultSMTPConfig.secure = process.env.DEFAULT_SMTP_SECURE === 'true';
			}

			if (process.env.DEFAULT_SMTP_TLS) {
				defaultSMTPConfig.tls = process.env.DEFAULT_SMTP_TLS;
			}

			if (process.env.DEFAULT_SMTP_IGNORE_TLS) {
				defaultSMTPConfig.ignoreTLS = process.env.DEFAULT_SMTP_IGNORE_TLS === 'true';
			}

			if (process.env.DEFAULT_SMTP_TLS_REJECT_UNAUTHORIZED) {
				defaultSMTPConfig.tls = { rejectUnauthorized: process.env.DEFAULT_SMTP_TLS_REJECT_UNAUTHORIZED === 'true' };
			}

			if (process.env.DEFAULT_SMTP_AUTH_METHOD) {
				defaultSMTPConfig.authMethod = process.env.DEFAULT_SMTP_AUTH_METHOD;
			}

			if (process.env.DEFAULT_SMTP_DEBUG) {
				defaultSMTPConfig.debug = process.env.DEFAULT_SMTP_DEBUG === 'true';
			}

			logger.info(`Setup default email server -> [${JSON.stringify(defaultSMTPConfig)}]`);
			transporters.default = createTransport(smtpTransport(defaultSMTPConfig));
		}

		mailConsumer.consume();
		return setInterval(function () {
			if (Date.now() - mailConsumer.lockedAt > 10 * 60 * 1000) {
				// 10 minutes
				return mailConsumer.consume();
			}
		}, 120000);
	},
};
