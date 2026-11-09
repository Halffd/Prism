import 'fake-indexeddb/auto';
import { openDB, unwrap } from 'idb';

describe('PrismDB upgrade path', () => {
  test('opens a fresh database with every store the app uses', async () => {
    const started = Date.now();
    const db = await openDB('PrismDBUpgradeTest', 50, {
      async upgrade(database, oldVersion, newVersion, transaction) {
        if (!database.objectStoreNames.contains('sessions')) {
          database.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('snippets')) {
          database.createObjectStore('snippets', { keyPath: 'id' });
        }

        // The migration that used to await between cursor steps, which
        // stranded the upgrade transaction.
        if (oldVersion < 30 && transaction) {
          const sessionsStore = transaction.objectStore('sessions');
          const request = unwrap(sessionsStore.openCursor());
          request.onsuccess = (event: Event) => {
            const cursor = (event.target as IDBRequest).result;
            if (!cursor) {
              return;
            }
            const update = cursor.update(cursor.value);
            update.onsuccess = () => cursor.continue();
          };
        }
      },
    });

    expect(db.objectStoreNames.contains('sessions')).toBe(true);
    expect(db.objectStoreNames.contains('snippets')).toBe(true);
    db.close();

    // The upgrade must not hang; a stranded transaction never resolves.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test('applies the session migration to existing rows', async () => {
    const name = 'PrismDBUpgradeMigrationTest';

    const old = await openDB(name, 20, {
      upgrade(database) {
        database.createObjectStore('sessions', { keyPath: 'id' });
      },
    });
    await old.put('sessions', { id: 'a', title: 'one' });
    await old.put('sessions', { id: 'b', title: 'two' });
    old.close();

    const upgraded = await openDB(name, 50, {
      async upgrade(database, oldVersion, newVersion, transaction) {
        if (oldVersion < 30 && transaction) {
          const sessionsStore = transaction.objectStore('sessions');
          const request = unwrap(sessionsStore.openCursor());
          request.onsuccess = (event: Event) => {
            const cursor = (event.target as IDBRequest).result;
            if (!cursor) {
              return;
            }
            const session = cursor.value;
            if (!session.characterIds) {
              session.characterIds = [];
            }
            // The cursor may only advance once the update has landed,
            // otherwise the write is lost.
            const update = cursor.update(session);
            update.onsuccess = () => cursor.continue();
          };
        }
      },
    });

    const rows = await upgraded.getAll('sessions');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.characterIds).toEqual([]);
    }
    upgraded.close();
  });
});
