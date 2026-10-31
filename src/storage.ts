import { ReportSchema, type Report } from './domain';

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('routewatch-fieldnotes', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Local storage could not be opened. Check browser storage permissions.'));
});

export async function readReports(): Promise<Report[]> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction('reports', 'readonly').objectStore('reports').getAll();
    request.onsuccess = () => {
      const parsed = ReportSchema.array().safeParse(request.result);
      if (parsed.success) resolve(parsed.data);
      else reject(new Error('Stored reports have an unsupported format. They have not been changed.'));
    };
    request.onerror = () => reject(new Error('Reports could not be read from local storage.'));
  });
}

export async function writeReports(reports: Report[], removeIds: string[] = []): Promise<void> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('reports', 'readwrite');
    const store = transaction.objectStore('reports');
    for (const id of removeIds) store.delete(id);
    for (const report of reports) store.put(report);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Reports were not saved. Browser storage may be full or unavailable.'));
    transaction.onabort = () => reject(new Error('The storage operation was interrupted. No reports were changed.'));
  });
}
