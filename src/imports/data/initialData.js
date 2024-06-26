import path from 'path';
import fs from 'fs/promises';
import { DateTime } from 'luxon';
import crypto from 'crypto';
import { hash as bcryptHash } from 'bcryptjs';

import { randomId, randomPassword } from '../utils/random';
import { GENERATED_PASSOWRD_LENGTH, BCRYPT_SALT_ROUNDS } from '../consts';

import { MetaObject } from '@imports/model/MetaObject';
import { logger } from '../utils/logger';
import { db } from '../database';

function metadataPath() {
	const dirName = path.resolve('.');

	if (process.env.NODE_ENV === 'production') {
		return path.join(dirName, './private/metadata');
	}

	return path.join(dirName, './src/private/metadata');
}
export async function checkInitialData() {
	const currentDateTime = DateTime.now().toJSDate();

	const metadataCount = await MetaObject.MetaObject.countDocuments();
	if (metadataCount === 0) {
		logger.info('[kondata] Create initial metadata');
		const loadPath = metadataPath();
		const metadata = await loadData(loadPath);
		await MetaObject.MetaObject.insertMany(metadata);
	}

	const adminId = randomId();
	const adminGroupId = randomId();
	const adminRoleId = randomId();
	const adminUser = {
		_id: adminId,
		group: {
			_id: adminGroupId,
			name: 'ADMIN',
		},
		name: 'Administrador',
		active: true,
	};

	const usersCount = await db.collection('users').countDocuments();
	if (usersCount === 0) {
		logger.info('[kondata] Create first user (admin)');

		let password = randomPassword(GENERATED_PASSOWRD_LENGTH);

		const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
		const hashPassword = await bcryptHash(hashedPassword, BCRYPT_SALT_ROUNDS);

		const user = {
			_id: adminId,
			_user: [adminUser],
			access: {
				defaults: ['Full'],
			},
			active: true,
			admin: true,
			code: 1,
			emails: [
				{
					address: 'support@konecty.com',
				},
			],
			group: {
				_id: adminGroupId,
				name: 'ADMIN',
			},
			locale: 'pt_BR',
			name: 'Administrador',
			role: {
				_id: '50a28a36e4b00438f136ae47',
				name: 'Administrator',
			},
			username: 'admin',
			services: {
				password: {
					bcrypt: hashPassword,
				},
			},
			_createdAt: currentDateTime,
			_createdBy: adminUser,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
		};

		await db.collection('users').insertOne(user);
		logger.info(`[kondata] Create first user (admin) with password ${password}`);
	}

	const groupsCount = await db.collection('data.Group').countDocuments();
	if (groupsCount === 0) {
		logger.info('[kondata] Create first group (ADMIN)');
		const adminGroup = {
			_id: adminGroupId,
			_createdAt: currentDateTime,
			_createdBy: adminUser,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
			_user: [adminUser],
			active: true,
			name: 'ADMIN',
		};
		await db.collection('data.Group').insertOne(adminGroup);
	}

	const rolesCount = await db.collection('data.Role').countDocuments();
	if (rolesCount === 0) {
		logger.info('[kondata] Create first roles (Administrator, User, Manager, Director)');
		const adminRole = {
			_id: adminRoleId,
			_createdBy: adminUser,
			_createdAt: currentDateTime,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
			_user: [adminUser],
			access: {
				defaults: ['Full'],
			},
			admin: true,
			name: 'Administrator',
		};

		const userRole = {
			_id: randomId(),
			_createdBy: adminUser,
			_createdAt: currentDateTime,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
			_user: [adminUser],
			access: {
				defaults: ['Default'],
			},
			name: 'User',
		};

		const managerRole = {
			_id: randomId(),
			_createdAt: currentDateTime,
			_createdBy: adminUser,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
			_user: [adminUser],
			access: {
				defaults: ['Default'],
			},
			name: 'Manager',
		};

		const directorRole = {
			_id: randomId(),
			_createdAt: currentDateTime,
			_createdBy: adminUser,
			_updatedAt: currentDateTime,
			_updatedBy: {
				...adminUser,
				ts: currentDateTime,
			},
			_user: [adminUser],
			access: {
				defaults: ['Default'],
			},
			name: 'Director',
		};

		await db.collection('data.Role').insertMany([adminRole, userRole, managerRole, directorRole]);
	}
}

async function loadData(loadPath) {
	const allData = await Promise.all(
		(await fs.readdir(loadPath, { withFileTypes: true })).map(async dirent => {
			if (dirent.isFile() && dirent.name.endsWith('.json')) {
				const content = await fs.readFile(`${loadPath}/${dirent.name}`, 'utf-8');
				const metadata = JSON.parse(content);
				return metadata;
			}
		}),
	);

	return allData.flat().filter(p => p);
}
