import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWebsite, resolvePublicWebsiteUrl } from '../services/websiteFetcher.js'

const publicAddress = { address: '93.184.216.34', family: 4 }
const publicDns = async () => [publicAddress]

test('allows public HTTPS URLs and resolves their host', async () => {
    const result = await resolvePublicWebsiteUrl('https://example.com/page', publicDns)

    assert.equal(result.url.href, 'https://example.com/page')
    assert.deepEqual(result.addresses, [publicAddress])
})

test('rejects non-HTTPS URLs, credentials, unusual ports, and IP literals', async () => {
    for (const url of [
        'http://example.com',
        'https://user:pass@example.com',
        'https://example.com:8443',
        'https://127.0.0.1',
        'https://[::1]',
    ]) {
        await assert.rejects(resolvePublicWebsiteUrl(url, publicDns), /Only public HTTPS/)
    }
})

test('rejects private, loopback, link-local, and reserved DNS results', async () => {
    for (const address of [
        '10.0.0.1',
        '127.0.0.1',
        '169.254.169.254',
        '192.0.2.10',
        'fc00::1',
        'fe80::1',
        '2001:db8::1',
    ]) {
        await assert.rejects(
            resolvePublicWebsiteUrl('https://example.com', async () => [{ address, family: 4 }]),
            /only to public IP/,
        )
    }
})

test('allows globally routable IPv6 addresses', async () => {
    const result = await resolvePublicWebsiteUrl('https://example.com', async () => [
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ])

    assert.equal(result.addresses[0].family, 6)
})

test('rejects hostnames that resolve to both public and private addresses', async () => {
    await assert.rejects(
        resolvePublicWebsiteUrl('https://example.com', async () => [
            publicAddress,
            { address: '10.0.0.5', family: 4 },
        ]),
        /only to public IP/,
    )
})

test('validates redirect destinations before making the next request', async () => {
    const requestedHosts = []
    const request = async url => {
        requestedHosts.push(url.hostname)
        return {
            status: 302,
            location: 'https://127.0.0.1/private',
        }
    }

    await assert.rejects(
        loadWebsite('https://example.com', { resolveHost: publicDns, request }),
        /Only public HTTPS/,
    )
    assert.deepEqual(requestedHosts, ['example.com'])
})

test('extracts readable text and title from HTML', async () => {
    const result = await loadWebsite('https://example.com', {
        resolveHost: publicDns,
        request: async () => ({
            status: 200,
            body: '<html><head><title>Example</title></head><body><h1>Hello</h1><p>World</p></body></html>',
        }),
    })

    assert.equal(result.title, 'Example')
    assert.equal(result.pageContent, 'HelloWorld')
})
