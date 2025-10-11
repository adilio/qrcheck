const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type CacheEntry<T> = {
  value: T;
  createdAt: number;
  accessedAt: number;
};

type StoreBackend<T> = {
  get(key: string): Promise<CacheEntry<T> | undefined>;
  set(key: string, value: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  entries(): Promise<Array<[string, CacheEntry<T>]>>;
};

const memoryStores = new Map<string, Map<string, CacheEntry<unknown>>>();

function getMemoryStore<T>(storeId: string): StoreBackend<T> {
  if (!memoryStores.has(storeId)) {
    memoryStores.set(storeId, new Map());
  }
  const map = memoryStores.get(storeId)!;
  return {
    async get(key) {
      return map.get(key) as CacheEntry<T> | undefined;
    },
    async set(key, value) {
      map.set(key, value as CacheEntry<unknown>);
    },
    async delete(key) {
      map.delete(key);
    },
    async entries() {
      return Array.from(map.entries()) as Array<[string, CacheEntry<T>]>;
    }
  };
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function openDatabase(name: string, store: string): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbStore<T>(dbName: string, storeName: string): Promise<StoreBackend<T>> {
  const db = await openDatabase(dbName, storeName);

  return {
    async get(key) {
      return await new Promise<CacheEntry<T> | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result as CacheEntry<T> | undefined);
      });
    },
    async set(key, value) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(value, key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve();
      });
    },
    async delete(key) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve();
      });
    },
    async entries() {
      return await new Promise<Array<[string, CacheEntry<T>]>>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        const keyReq = store.getAllKeys();
        const result: Array<[string, CacheEntry<T>]> = [];
        let values: CacheEntry<T>[] | undefined;
        let keys: IDBValidKey[] | undefined;
        req.onerror = keyReq.onerror = () => reject(req.error ?? keyReq.error);
        req.onsuccess = () => {
          values = req.result as CacheEntry<T>[];
          if (keys) {
            resolve(keys.map((key, index) => [String(key), values![index]]));
          }
        };
        keyReq.onsuccess = () => {
          keys = keyReq.result as IDBValidKey[];
          if (values) {
            resolve(keys.map((key, index) => [String(key), values![index]]));
          }
        };
      });
    }
  };
}

export interface CacheOptions {
  dbName: string;
  storeName: string;
  maxAgeMs?: number;
  maxEntries?: number;
}

export class TTLCache<T> {
  private backendPromise: Promise<StoreBackend<T>>;
  private maxAgeMs: number;
  private maxEntries: number;
  private storeId: string;

  constructor(options: CacheOptions) {
    this.maxAgeMs = options.maxAgeMs ?? ONE_DAY_MS;
    this.maxEntries = options.maxEntries ?? 200;
    this.storeId = `${options.dbName}:${options.storeName}`;

    if (hasIndexedDB()) {
      this.backendPromise = idbStore<T>(options.dbName, options.storeName);
    } else {
      this.backendPromise = Promise.resolve(getMemoryStore<T>(this.storeId));
    }
  }

  private async backend() {
    return await this.backendPromise;
  }

  async get(key: string): Promise<T | undefined> {
    const store = await this.backend();
    const entry = await store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > this.maxAgeMs) {
      await store.delete(key);
      return undefined;
    }
    entry.accessedAt = Date.now();
    await store.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: T): Promise<void> {
    const store = await this.backend();
    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      accessedAt: Date.now()
    };
    await store.set(key, entry);
    await this.pruneIfNeeded(store);
  }

  async delete(key: string): Promise<void> {
    const store = await this.backend();
    await store.delete(key);
  }

  private async pruneIfNeeded(store: StoreBackend<T>): Promise<void> {
    const entries = await store.entries();
    const now = Date.now();
    const valid = entries.filter(([, entry]) => now - entry.createdAt <= this.maxAgeMs);

    if (valid.length !== entries.length) {
      const staleKeys = entries
        .filter(([, entry]) => now - entry.createdAt > this.maxAgeMs)
        .map(([key]) => key);
      await Promise.all(staleKeys.map((key) => store.delete(key)));
    }

    if (valid.length > this.maxEntries) {
      const sorted = valid.sort((a, b) => a[1].accessedAt - b[1].accessedAt);
      const toRemove = sorted.slice(0, valid.length - this.maxEntries);
      await Promise.all(toRemove.map(([key]) => store.delete(key)));
    }
  }
}
