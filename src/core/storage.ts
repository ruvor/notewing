// Persistent storage: a key-value store plus a content-addressed blob cache.

export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  getBlob(sha: string): Promise<Uint8Array | undefined>;
  putBlob(sha: string, data: Uint8Array): Promise<void>;
  /** Blob shas present in the cache. */
  blobKeys(): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryStorage implements Storage {
  kv = new Map<string, unknown>();
  blobs = new Map<string, Uint8Array>();
  async get<T>(key: string) {
    return structuredClone(this.kv.get(key)) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.kv.set(key, structuredClone(value));
  }
  async del(key: string) {
    this.kv.delete(key);
  }
  async getBlob(sha: string) {
    return this.blobs.get(sha);
  }
  async putBlob(sha: string, data: Uint8Array) {
    this.blobs.set(sha, data);
  }
  async blobKeys() {
    return [...this.blobs.keys()];
  }
  async clear() {
    this.kv.clear();
    this.blobs.clear();
  }
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** IndexedDB storage; one database per repository so repositories never mix. */
export class IdbStorage implements Storage {
  private db: Promise<IDBDatabase>;

  constructor(public name: string) {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("kv");
        open.result.createObjectStore("blobs");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async store(name: "kv" | "blobs", mode: IDBTransactionMode) {
    return (await this.db).transaction(name, mode).objectStore(name);
  }

  async get<T>(key: string) {
    return req<T | undefined>((await this.store("kv", "readonly")).get(key));
  }
  async set(key: string, value: unknown) {
    await req((await this.store("kv", "readwrite")).put(value, key));
  }
  async del(key: string) {
    await req((await this.store("kv", "readwrite")).delete(key));
  }
  async getBlob(sha: string) {
    const v = await req<ArrayBuffer | Uint8Array | undefined>((await this.store("blobs", "readonly")).get(sha));
    return v && (v instanceof Uint8Array ? v : new Uint8Array(v));
  }
  async putBlob(sha: string, data: Uint8Array) {
    await req((await this.store("blobs", "readwrite")).put(data, sha));
  }
  async blobKeys() {
    return (await req((await this.store("blobs", "readonly")).getAllKeys())) as string[];
  }
  async clear() {
    await req((await this.store("kv", "readwrite")).clear());
    await req((await this.store("blobs", "readwrite")).clear());
  }
  async close() {
    (await this.db).close();
  }
  static async destroy(name: string) {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
}
