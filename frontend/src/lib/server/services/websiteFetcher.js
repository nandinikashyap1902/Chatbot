import { lookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import { load } from 'cheerio'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 4
const REQUEST_TIMEOUT_MS = 10_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const BLOCKED_IPV4_RANGES = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
]

export class WebsiteUrlError extends Error {
    constructor(message) {
        super(message)
        this.name = 'WebsiteUrlError'
        this.status = 400
    }
}

function ipv4ToNumber(address) {
    return address.split('.').reduce((result, part) => (result * 256) + Number(part), 0)
}

function isInIpv4Range(address, network, prefixLength) {
    const mask = 2 ** 32 - 2 ** (32 - prefixLength)
    return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask)
}

function ipv6ToBigInt(address) {
    let normalized = address.toLowerCase()
    if (normalized.includes('.')) {
        const lastColon = normalized.lastIndexOf(':')
        const ipv4 = normalized.slice(lastColon + 1).split('.').map(Number)
        const high = ((ipv4[0] << 8) | ipv4[1]).toString(16)
        const low = ((ipv4[2] << 8) | ipv4[3]).toString(16)
        normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`
    }

    const halves = normalized.split('::')
    const left = halves[0] ? halves[0].split(':') : []
    const right = halves[1] ? halves[1].split(':') : []
    const missingGroups = 8 - left.length - right.length
    const groups = halves.length === 2
        ? [...left, ...Array(missingGroups).fill('0'), ...right]
        : left

    if (groups.length !== 8) return null
    return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || '0'}`), 0n)
}

function isPublicAddress(address) {
    const family = isIP(address)
    if (family === 4) {
        return !BLOCKED_IPV4_RANGES.some(([network, prefix]) =>
            isInIpv4Range(address, network, prefix),
        )
    }

    if (family !== 6) return false
    const value = ipv6ToBigInt(address)
    if (value === null) return false

    const globalUnicast = (value >> 125n) === 1n
    const isIpv4Mapped = (value >> 32n) === 0xffffn
    const firstGroup = Number((value >> 112n) & 0xffffn)
    const secondGroup = Number((value >> 96n) & 0xffffn)
    const isSpecial2001 = firstGroup === 0x2001
        && (secondGroup <= 0x01ff || secondGroup === 0x0db8)
    const isSixToFour = firstGroup === 0x2002
    const isDocumentation = firstGroup === 0x3fff && secondGroup <= 0x000f

    return globalUnicast && !isIpv4Mapped && !isSpecial2001 && !isSixToFour && !isDocumentation
}

function parseWebsiteUrl(input) {
    let url
    try {
        url = new URL(input)
    } catch {
        throw new WebsiteUrlError('Invalid URL')
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (
        url.protocol !== 'https:'
        || (url.port && url.port !== '443')
        || url.username
        || url.password
        || isIP(hostname)
        || hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname.endsWith('.internal')
    ) {
        throw new WebsiteUrlError('Only public HTTPS website URLs are supported')
    }

    return url
}

export async function resolvePublicWebsiteUrl(input, resolveHost = lookup) {
    const url = parseWebsiteUrl(input)
    let addresses
    try {
        addresses = await resolveHost(url.hostname, { all: true, verbatim: true })
    } catch {
        throw new WebsiteUrlError('Website host could not be resolved')
    }

    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new WebsiteUrlError('Website host must resolve only to public IP addresses')
    }

    return { url, addresses }
}

function requestPinned(url, addresses) {
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'user-agent': 'RAG-Assistant/1.0',
            },
            lookup: (_hostname, options, callback) => {
                if (options?.all) {
                    callback(null, addresses)
                    return
                }

                callback(null, addresses[0].address, addresses[0].family)
            },
        }, response => {
            const status = response.statusCode || 0
            if (REDIRECT_STATUSES.has(status)) {
                const location = response.headers.location
                response.resume()
                resolve({ status, location })
                return
            }

            if (status < 200 || status >= 300) {
                response.resume()
                reject(new Error(`Website returned HTTP ${status}`))
                return
            }

            const contentType = response.headers['content-type'] || ''
            if (!/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
                response.resume()
                reject(new Error('Website did not return HTML content'))
                return
            }

            const contentLength = Number(response.headers['content-length'])
            if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
                response.resume()
                reject(new Error('Website response is too large'))
                return
            }

            const chunks = []
            let size = 0
            response.on('data', chunk => {
                size += chunk.length
                if (size > MAX_RESPONSE_BYTES) {
                    response.destroy(new Error('Website response is too large'))
                    return
                }
                chunks.push(chunk)
            })
            response.on('end', () => resolve({
                status,
                body: Buffer.concat(chunks).toString('utf8'),
            }))
            response.on('error', reject)
        })

        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(new Error('Website request timed out'))
        })
        request.on('error', reject)
        request.end()
    })
}

export async function loadWebsite(input, options = {}) {
    const resolveHost = options.resolveHost || lookup
    const request = options.request || requestPinned
    let target = input

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
        const { url, addresses } = await resolvePublicWebsiteUrl(target, resolveHost)
        const response = await request(url, addresses)

        if (REDIRECT_STATUSES.has(response.status)) {
            if (!response.location || redirects === MAX_REDIRECTS) {
                throw new Error('Website redirect limit exceeded')
            }
            target = new URL(response.location, url).toString()
            continue
        }

        const $ = load(response.body)
        return {
            pageContent: $('p, h1, h2, h3, h4, li, article, main').text(),
            title: $('title').text(),
        }
    }

    throw new Error('Website redirect limit exceeded')
}
