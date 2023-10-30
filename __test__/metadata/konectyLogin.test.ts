import { expect } from 'chai';
import { createHash } from 'crypto';

describe.skip('Outros', () => {
	describe('Autenticação', () => {
		it('Login com usuario admin permitido', async () => {
			// Arrange
			const user = 'admin';
			const plainPassword = '123456';
			const password = createHash('md5').update(plainPassword).digest('hex');
			const password_SHA256 = createHash('sha256').update(plainPassword).digest('hex');

			// Act
			const response = await fetch('http://127.0.0.1:3000/rest/auth/login', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: `user=${user}&password=${password}&password_SHA256=${password_SHA256}&ns=foxter&resolution=%7B%22height%22%3A1050%2C%22width%22%3A1680%7D`,
			});

			const data = (await response.json()) as { success: boolean };

			// Assert
			expect(data.success).to.be.equal(true);
		});
	});
});
