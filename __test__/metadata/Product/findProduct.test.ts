import { expect } from 'chai';
import { login } from '../../utils/login';
import { KonectyResponse } from '../../utils/types';
import { db } from '@imports/database';

async function createProductHelper(authId: string) {
	const requiredFields = {
		name: 'Teste',
		status: 'draft',
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

describe('Find Product', () => {
	describe('Admin', () => {
		const authId = login('admin-test');
		let product: { _id: string } = {
			_id: '',
		};
		beforeEach(async () => {
			product = (await createProductHelper(authId)) as { _id: string };
		});

		afterEach(async () => {
			await db.collection('data.Product').deleteMany({});
		});

		it('Find Product', async () => {
			// Arrange

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product/find`, {
				method: 'GET',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(true);
			expect(data.data?.length).to.be.equal(1);
			// compare data.data with the data created in beforeEach
			expect(data.data?.[0].name).to.be.equal('Teste');
			expect(data.data?.[0].status).to.be.equal('draft');
		});

		it('Find Product', async () => {
			// Arrange

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product/${product._id}`, {
				method: 'GET',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(true);
			expect(data.total).to.be.equal(1);
			// compare data.data with the data created in beforeEach
			expect(data.data?.[0].name).to.be.equal('Teste');
			expect(data.data?.[0].status).to.be.equal('draft');
		});

		it('Find Product with field projection', async () => {
			// Arrange

			// Act
			const data = (await fetch(`http://127.0.0.1:3000/rest/data/Product/find?fields=name`, {
				method: 'GET',
				headers: {
					Cookie: `_authTokenId=${authId}`,
					'Content-Type': 'application/json',
				},
			}).then(res => res.json())) as KonectyResponse;

			// Assert
			expect(data.success).to.be.equal(true);
			expect(data.data?.length).to.be.equal(1);
			// compare data.data with the data created in beforeEach
			expect(data.data?.[0].name).to.be.equal('Teste');
			expect(data.data?.[0].status).to.be.undefined;
			expect(data.data?.[0].code).to.be.undefined;
		});
	});
});
