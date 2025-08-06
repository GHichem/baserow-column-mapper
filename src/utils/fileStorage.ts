/**
 * Enhanced file storage utility using IndexedDB for large files
 * This eliminates the need for proxy server by storing large files locally
 */

interface StoredFileData {
  id: string;
  content: string;
  metadata: {
    name: string;
    size: number;
    recordId: number;
    timestamp: number;
    baserowUrl: string;
  };
}

class FileStorageManager {
  private dbName = 'BaserowFileStorage';
  private dbVersion = 2; // Increment version to force database recreation
  private storeName = 'files';
  private db: IDBDatabase | null = null;

  async reinitializeDB(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    // Delete the existing database and recreate it
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      deleteRequest.onsuccess = async () => {
        try {
          await this.openDB();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db && this.db.objectStoreNames.contains(this.storeName)) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        
        // Verify the object store exists
        if (!this.db.objectStoreNames.contains(this.storeName)) {
          this.db.close();
          this.db = null;
          reject(new Error('Object store not found'));
          return;
        }
        
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('recordId', 'metadata.recordId', { unique: false });
          store.createIndex('timestamp', 'metadata.timestamp', { unique: false });
        }
      };
    });
  }

  async storeFile(
    recordId: number,
    content: string,
    metadata: {
      name: string;
      size: number;
      baserowUrl: string;
    }
  ): Promise<string> {
    try {
      // Check if we have enough storage space (rough estimate)
      const contentSize = content.length * 2; // UTF-16 encoding overhead
      const storageInfo = await this.getStorageInfo();
      
      if (storageInfo.available > 0 && contentSize > (storageInfo.available * 0.8)) {
        throw new Error('Insufficient storage space for file');
      }

      let db: IDBDatabase;
      try {
        db = await this.openDB();
      } catch (error) {
        await this.reinitializeDB();
        db = await this.openDB();
      }
      
      // Double-check the object store exists before creating transaction
      if (!db.objectStoreNames.contains(this.storeName)) {
        await this.reinitializeDB();
        db = await this.openDB();
      }
      
      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const fileData: StoredFileData = {
        id: `file_${recordId}_${Date.now()}`,
        content,
        metadata: {
          ...metadata,
          recordId,
          timestamp: Date.now(),
        },
      };

      await new Promise<void>((resolve, reject) => {
        const request = store.put(fileData);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));
      });

      return fileData.id;
    } catch (error) {
      throw error;
    }
  }

  async getFile(recordId: number): Promise<string | null> {
    try {
      const db = await this.openDB();
      
      // Check if the object store exists
      if (!db.objectStoreNames.contains(this.storeName)) {
        return null;
      }

      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      // Check if the recordId index exists
      if (!store.indexNames.contains('recordId')) {
        console.log('📁 IndexedDB recordId index not yet created');
        return null;
      }
      
      const index = store.index('recordId');

      return new Promise<string | null>((resolve, reject) => {
        const request = index.getAll(recordId);
        request.onsuccess = () => {
          const files = request.result as StoredFileData[];
          if (files.length === 0) {
            resolve(null);
          } else {
            // Get the most recent file
            const latestFile = files.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp)[0];
            console.log(`✅ Retrieved file from IndexedDB: ${latestFile.id} (${(latestFile.content.length / 1024 / 1024).toFixed(2)}MB)`);
            resolve(latestFile.content);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('❌ Failed to retrieve file from IndexedDB:', error);
      return null;
    }
  }

  async deleteFile(recordId: number): Promise<void> {
    try {
      const db = await this.openDB();
      
      // Check if the object store exists
      if (!db.objectStoreNames.contains(this.storeName)) {
        console.log('📁 IndexedDB object store not yet created, nothing to delete');
        return;
      }

      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Check if the recordId index exists
      if (!store.indexNames.contains('recordId')) {
        console.log('📁 IndexedDB recordId index not yet created, nothing to delete');
        return;
      }
      
      const index = store.index('recordId');

      const files = await new Promise<StoredFileData[]>((resolve, reject) => {
        const request = index.getAll(recordId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const file of files) {
        await new Promise<void>((resolve, reject) => {
          const request = store.delete(file.id);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }

      if (files.length > 0) {
        console.log(`✅ Deleted ${files.length} files for record ${recordId} from IndexedDB`);
      }
    } catch (error) {
      console.error('❌ Failed to delete file from IndexedDB:', error);
    }
  }

  async cleanupOldFiles(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const db = await this.openDB();
      
      // Check if the object store exists before proceeding
      if (!db.objectStoreNames.contains(this.storeName)) {
        console.log('📁 IndexedDB object store not yet created, skipping cleanup');
        return;
      }

      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      // Check if the timestamp index exists
      if (!store.indexNames.contains('timestamp')) {
        console.log('📁 IndexedDB timestamp index not yet created, skipping cleanup');
        return;
      }
      
      const index = store.index('timestamp');
      const cutoffTime = Date.now() - maxAge;
      const range = IDBKeyRange.upperBound(cutoffTime);

      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);
        let deletedCount = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            deletedCount++;
            cursor.continue();
          } else {
            if (deletedCount > 0) {
              console.log(`✅ Cleaned up ${deletedCount} old files from IndexedDB`);
            }
            resolve();
          }
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      // Only log error if it's not a "not found" error during initial setup
      if (error instanceof Error && !error.message.includes('not found')) {
        console.error('❌ Failed to cleanup old files:', error);
      }
    }
  }

  async getStorageInfo(): Promise<{ used: number; available: number }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          available: estimate.quota || 0,
        };
      }
    } catch (error) {
      console.warn('Could not get storage info:', error);
    }

    return { used: 0, available: 0 };
  }

  async initialize(): Promise<void> {
    try {
      await this.openDB();
    } catch (error) {
      console.warn('IndexedDB initialization failed:', error);
    }
  }
}

// Export singleton instance
export const fileStorage = new FileStorageManager();

// Helper function to check if IndexedDB is available
export const isIndexedDBAvailable = (): boolean => {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
};

// Initialize cleanup on page load
if (typeof window !== 'undefined' && isIndexedDBAvailable()) {
  // Delay initialization to ensure proper setup
  setTimeout(async () => {
    try {
      // Ensure database is properly initialized before cleanup
      await fileStorage.initialize();
      
      // Clean up files older than 24 hours on startup
      await fileStorage.cleanupOldFiles();
      
      // Show storage info in console for debugging
      const info = await fileStorage.getStorageInfo();
      if (info.available > 0) {
        const usedMB = (info.used / 1024 / 1024).toFixed(2);
        const availableMB = (info.available / 1024 / 1024).toFixed(2);
        console.log(`💾 Storage: ${usedMB}MB used / ${availableMB}MB available`);
      }
    } catch (error) {
      // Silently handle initialization errors to prevent console spam
      if (error instanceof Error && !error.message.includes('not found')) {
        console.warn('⚠️ IndexedDB initialization warning:', error.message);
      }
    }
  }, 1000); // 1 second delay to ensure proper initialization
}
