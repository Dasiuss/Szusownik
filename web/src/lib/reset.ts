import { db } from "./db.ts";

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error ?? new Error(`Nie udało się usunąć bazy ${name}.`));
    request.onsuccess = () => resolve();
    request.onblocked = () => reject(new Error(`Baza ${name} jest nadal używana.`));
  });
}

async function deleteIndexedDbData(): Promise<void> {
  const databaseFactory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  const knownNames = new Set<string>([db.name]);
  if (databaseFactory.databases) {
    const databases = await databaseFactory.databases();
    for (const database of databases) {
      if (database.name) knownNames.add(database.name);
    }
  }

  await db.delete();
  await Promise.all([...knownNames].filter((name) => name !== db.name).map(deleteDatabase));
}

async function deleteServiceWorkerData(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }
}

export async function clearPwaData(): Promise<void> {
  await deleteIndexedDbData();
  window.localStorage.clear();
  window.sessionStorage.clear();
  await deleteServiceWorkerData();
  window.name = "";
}
