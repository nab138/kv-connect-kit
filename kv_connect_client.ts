
// https://github.com/denoland/deno/tree/main/ext/kv#kv-connect
// https://github.com/denoland/deno/blob/main/cli/schemas/kv-metadata-exchange-response.v1.json
// https://github.com/denoland/deno/blob/main/ext/kv/proto/datapath.proto


import { encodeBinary as encodeAtomicWrite } from './gen/messages/datapath/AtomicWrite.ts';
import { encodeBinary as encodeSnapshotRead } from './gen/messages/datapath/SnapshotRead.ts';
import { decodeBinary as decodeSnapshotReadOutput } from './gen/messages/datapath/SnapshotReadOutput.ts';
import { decodeBinary as decodeAtomicWriteOutput } from './gen/messages/datapath/AtomicWriteOutput.ts';
import { AtomicWrite, AtomicWriteOutput, SnapshotRead, SnapshotReadOutput } from './gen/messages/datapath/index.ts';
import { decodeV8, encodeV8 } from './v8.ts';

export async function openKv(url: string, { accessToken }: { accessToken: string }): Promise<unknown> {

    const metadata = await fetchDatabaseMetadata(url, accessToken);
    const { version, endpoints, token, expiresAt } = metadata;
    if (version !== 1) throw new Error(`Unsupported version: ${version}`);
    if (endpoints.length === 0) throw new Error(`No endpoints`);
    const expiresTime = new Date(expiresAt).getTime();
    console.log(`Expires in ${expiresTime - Date.now()}ms`);

    const endpointUrl = endpoints[0].url;

    const testRead = false;
    if (testRead) {
        const snapshotReadUrl = new URL('/snapshot_read', endpointUrl).toString();

        const encoder = new TextEncoder();
        const read: SnapshotRead = { ranges: [ 
            { limit: 10, reverse: false, start: encoder.encode(''), end: encoder.encode('z') }

        ] };
        const result = await fetchSnapshotRead(snapshotReadUrl, token, metadata.databaseId, read);
        for (const range of result.ranges) {
            for (const entry of range.values) {
                console.log(entry.key);
                console.log(decodeV8(entry.value));
                console.log(entry.versionstamp);
                console.log(entry.encoding);
            }
        }
    }
    const testWrite = true;
    if (testWrite) {
        const atomicWriteUrl = new URL('/atomic_write', endpointUrl).toString();

        const write: AtomicWrite = {
            enqueues: [
                {
                    backoffSchedule: [],
                    deadlineMs: '10000',
                    kvKeysIfUndelivered: [],
                    payload: encodeV8('hi!'),
                }
            ],
            kvChecks: [],
            kvMutations: [],
        };
        const result = await fetchAtomicWrite(atomicWriteUrl, token, metadata.databaseId, write);
        console.log(result);

    }
    
    throw new Error();
}

export interface DatabaseMetadata {
    readonly version: number; // 1
    readonly databaseId: string; // uuid v4
    readonly endpoints: EndpointInfo[];
    readonly token: string;
    readonly expiresAt: string; // 2023-09-17T16:39:10Z
}

export interface EndpointInfo {
    readonly url: string; // https://us-east4.txnproxy.deno-gcp.net
    readonly consistency: string; // strong
}

//

async function fetchDatabaseMetadata(url: string, accessToken: string): Promise<DatabaseMetadata> {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } });
    if (res.status !== 200) throw new Error(`Unexpected response status: ${res.status} ${await res.text()}`);
    const contentType = res.headers.get('content-type') ?? undefined;
    if (contentType !== 'application/json') throw new Error(`Unexpected response content-type: ${contentType} ${await res.text()}`);
    const metadata = await res.json();
    if (!isDatabaseMetadata(metadata)) throw new Error(`Bad DatabaseMetadata: ${JSON.stringify(metadata)}`);
    return metadata;
}

async function fetchSnapshotRead(url: string, accessToken: string, databaseId: string, read: SnapshotRead): Promise<SnapshotReadOutput> {
    return decodeSnapshotReadOutput(await fetchProtobuf(url, accessToken, databaseId,  encodeSnapshotRead(read)));
}

async function fetchAtomicWrite(url: string, accessToken: string, databaseId: string, write: AtomicWrite): Promise<AtomicWriteOutput> {
    return decodeAtomicWriteOutput(await fetchProtobuf(url, accessToken, databaseId,  encodeAtomicWrite(write)));
}

async function fetchProtobuf(url: string, accessToken: string, databaseId: string, body: Uint8Array): Promise<Uint8Array> {
    const res = await fetch(url, { method: 'POST', body, headers: { 'x-transaction-domain-id': databaseId , authorization: `Bearer ${accessToken}` } });
    if (res.status !== 200) throw new Error(`Unexpected response status: ${res.status} ${await res.text()}`);
    const contentType = res.headers.get('content-type') ?? undefined;
    if (contentType !== 'application/x-protobuf') throw new Error(`Unexpected response content-type: ${contentType} ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
}

function isEndpointInfo(obj: unknown): obj is EndpointInfo {
    if (!isRecord(obj)) return false;
    const { url, consistency, ...rest } = obj;
    return typeof url === 'string' && typeof consistency === 'string' && Object.keys(rest).length === 0;
}

function isDatabaseMetadata(obj: unknown): obj is DatabaseMetadata {
    if (!isRecord(obj)) return false;
    const { version, databaseId, endpoints, token, expiresAt, ...rest } = obj;
    return typeof version === 'number' && typeof databaseId === 'string' && Array.isArray(endpoints) && endpoints.every(isEndpointInfo) && typeof token === 'string' && typeof expiresAt === 'string' && Object.keys(rest).length === 0;
}

function isRecord(obj: unknown): obj is Record<string, unknown> {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj) && obj.constructor === Object;
}
