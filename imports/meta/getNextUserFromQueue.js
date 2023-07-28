import { Collections } from '/imports/model/MetaObject';
import { convertObjectIds } from '/imports/utils/mongo';

export async function getNextUserFromQueue(queueStrId, user) {
	const collection = Collections['QueueUser'];

	if (collection == null) {
		return {
			success: false,
			errors: [
				{
					message: `Error getting next user from queue: QueueUser collection not found!`,
				},
			],
		};
	}

	const query = { 'queue._id': queueStrId };

	const sort = {
		count: 1,
		order: 1,
	};

	const update = {
		$inc: {
			count: 1,
		},
		$set: {
			_updatedAt: new Date(),
			_updatedBy: {
				_id: user._id,
				name: user.name,
				group: user.group,
			},
		},
	};

	const options = {
		returnNewDocument: true,
		sort: sort,
	};

	const queueUser = await collection.findOneAndUpdate(query, update, options);

	if (queueUser?.value != null) {
		return {
			success: true,
			data: convertObjectIds(queueUser.value),
		};
	}

	const queueOwner = await Collections['Queue'].findOne({ _id: queueStrId });

	if (queueOwner == null) {
		return {
			success: false,
			errors: [
				{
					message: `Error getting next user from queue: Queue not found!`,
				},
			],
		};
	}

	if (queueOwner?._user != null && queueOwner._user.length > 0) {
		return {
			success: true,
			data: convertObjectIds(queueOwner._user[0]),
		};
	}

	return {
		success: false,
		errors: [
			{
				message: `Error getting next user from queue: No users found!`,
			},
		],
	};
}
