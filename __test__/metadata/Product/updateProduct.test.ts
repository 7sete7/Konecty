import { expect } from 'chai';
import { login } from '../../utils/login';
import { KonectyResponse } from '../../utils/types';
import { db } from '@imports/database';

async function createProductHelper(authId: string) {
	const requiredFields = {
		name: 'Teste',
	};
	const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
		method: 'POST',
		headers: {
			Cookie: `_authTokenId=${authId}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(requiredFields),
	}).then(res => res.json())) as KonectyResponse;

	return data.data?.[0];
}

describe('Update Product', () => {
	describe('Admin', () => {
		const authId = login('admin-test');
		beforeEach(async () => {
			await db.collection('data.Product').deleteMany({});
		});

		it('Should not update Product because invalid field', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: {},
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(false);
			expect(data.errors?.[0].message).to.be.equal('Value for field name must be a valid String');
		});

		it('Update Product', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: 'Test Updated',
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(true);
			expect(data.data?.[0].name).to.be.equal('Test Updated');
			expect(data.data?.[0].code).to.be.equal(1);
		});

		it('Update Product and test scriptBeforeValidation', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: 'Test Updated',
					status: 'active',
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(product.activatedAt).to.not.exist;
			expect(data.success).to.be.equal(true);
			expect(data.data?.[0].activatedAt).to.exist;
		});
	});

	describe('User', () => {
		const authId = login('user-test');
		beforeEach(async () => {
			await db.collection('data.Product').deleteMany({});
		});

		it('Should not update Product because invalid field', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: {},
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(false);
			expect(data.errors?.[0].message).to.be.equal('Value for field name must be a valid String');
		});

		it('Update Product', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: 'Test Updated',
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(true);
			expect(data.data?.[0].name).to.be.equal('Test Updated');
			expect(data.data?.[0].code).to.be.equal(1);
		});

		it('Should not update Product without permission', async () => {
			// Arrange
			const product = await createProductHelper(authId);

			const requestFields = {
				data: {
					name: 'Test Updated',
					status: 'active',
				},
				ids: [
					{
						_id: product._id,
						_updatedAt: {
							$date: product._updatedAt,
						},
					},
				],
			};

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product`, {
				method: 'PUT',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestFields),
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(product.status).to.be.equal('draft');
			expect(data.success).to.be.equal(false);
			expect(data.errors?.[0].message).to.be.equal("[Product] You don't have permission to update field status");
		});
	});
});
