import { jest } from '@jest/globals';
import { fetchWhatsAppVersion } from '../modules/utils.js';

describe('fetchWhatsAppVersion', () => {
    const mockHtmlSuccess = `
        <div>
            <a href="https://web.whatsapp.com/?v=2.3000.1019933358-alpha">Some text</a>
        </div>
    `;

    const mockHtmlFailure = `
        <div>
            <a href="https://web.whatsapp.com/">Invalid version</a>
        </div>
    `;

    // Root level beforeEach/afterEach for common mocks
    beforeEach(() => {
        console.error = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('with mocked fetch', () => {
        let mockFetch;

        beforeEach(() => {
            // Initialize fetch mock with a default implementation
            mockFetch = jest.fn();
            global.fetch = mockFetch;
        });

        afterEach(() => {
            delete global.fetch;
        });

        test('should extract version numbers when HTML contains valid version', async () => {
            mockFetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockHtmlSuccess),
            });

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([2, 3000, 1019933358]);
            expect(mockFetch).toHaveBeenCalledWith('https://wppconnect.io/whatsapp-versions/');
        });

        test('should return empty array when version pattern is not found', async () => {
            mockFetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockHtmlFailure),
            });

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([]);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
            );
        });

        test('should handle fetch errors gracefully', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([]);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
            );
        });

        test('should handle HTTP error responses', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                text: () => Promise.reject(new Error('HTTP Error')),
            });

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([]);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
            );
        });

        test('should handle empty response', async () => {
            mockFetch.mockResolvedValueOnce({
                text: () => Promise.resolve(''),
            });

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([]);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
            );
        });

        test('should handle malformed HTML response', async () => {
            mockFetch.mockResolvedValueOnce({
                text: () => Promise.resolve('<div>Malformed HTML without version</div>'),
            });

            const version = await fetchWhatsAppVersion();
            expect(version).toEqual([]);
            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
            );
        });
    });

    describe('with real fetch', () => {
        test('should either fetch valid version or handle failure gracefully', async () => {
            const version = await fetchWhatsAppVersion();

            if (version.length > 0) {
                expect(Array.isArray(version)).toBe(true);
                expect(version).toHaveLength(3);
                version.forEach(num => {
                    expect(Number.isInteger(num)).toBe(true);
                    expect(num).toBeGreaterThan(0);
                });
            } else {
                expect(console.error).toHaveBeenCalledWith(
                    expect.stringContaining('Erro ao verificar versão atual do WhatsApp!')
                );
            }
        }, 10000);
    });
});