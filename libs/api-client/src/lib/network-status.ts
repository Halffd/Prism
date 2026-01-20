// Network status detection for offline-first functionality

// Type declarations for browser globals
declare const navigator: any;
declare const window: any;
declare const Image: any;

export interface NetworkStatus {
  online: boolean;
  lastCheck: Date;
}

class NetworkStatusService {
  private isOnline: boolean = true;
  private listeners: Array<(status: NetworkStatus) => void> = [];
  private timerId: NodeJS.Timeout | null = null;
  private apiUrl: string | null = null;

  constructor(apiUrl?: string) {
    this.apiUrl = apiUrl || process.env.PRISM_API_URL || null;
    // Initialize network detection
    this.setupNetworkDetection();
  }

  private setupNetworkDetection() {
    // Initial check - only in browser environment
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      this.isOnline = Boolean((navigator as any).onLine);
    } else {
      // Default to true if we can't determine
      this.isOnline = true;
    }

    // Listen to online/offline events - only in browser environment
    if (typeof window !== 'undefined') {
      (window as any).addEventListener?.('online', this.handleOnline.bind(this));
      (window as any).addEventListener?.('offline', this.handleOffline.bind(this));
    }

    // Set up periodic checks for more robust detection
    this.startPeriodicCheck();
  }

  private handleOnline() {
    this.isOnline = true;
    this.notifyListeners();
  }

  private handleOffline() {
    this.isOnline = false;
    this.notifyListeners();
  }

  private async performPingCheck(): Promise<boolean> {
    // Perform a simple ping to check connectivity
    try {
      let pingUrl = 'https://httpbin.org/get'; // Default fallback

      // If we have an API URL, try to ping the status endpoint first
      if (this.apiUrl) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          const response = await fetch(`${this.apiUrl}/status`, {
            method: 'GET',
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            return true;
          }
        } catch (error) {
          // If the API URL ping fails, fall back to the external check
          console.debug('API URL ping failed, falling back to external check:', error);
        }
      }

      // Try to ping a reliable external endpoint as fallback
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(pingUrl, {
        method: 'GET',
        signal: controller.signal
      }).catch((error) => {
        // If fetch is not available, try a simple image request (only in browser)
        if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ ok: true } as Response);
            img.onerror = () => resolve({ ok: false } as Response);
            img.src = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==?t=${Date.now()}`;
          }) as Promise<Response>;
        } else {
          // In Node.js environment, return a failure response
          return { ok: false } as Response;
        }
      });

      clearTimeout(timeoutId);
      return response.ok === true;
    } catch (error: any) {
      return false;
    }
  }

  private startPeriodicCheck() {
    // Check connectivity every 5 seconds if we're online, every 10 seconds if offline
    this.timerId = setInterval(async () => {
      const isCurrentlyOnline = await this.performPingCheck();
      
      if (this.isOnline !== isCurrentlyOnline) {
        this.isOnline = isCurrentlyOnline;
        this.notifyListeners();
      }
    }, 5000); // Check every 5 seconds
  }

  public isCurrentlyOnline(): boolean {
    return this.isOnline;
  }

  public addNetworkStatusListener(callback: (status: NetworkStatus) => void) {
    this.listeners.push(callback);
    // Call immediately with current status
    callback({ online: this.isOnline, lastCheck: new Date() });
  }

  public removeNetworkStatusListener(callback: (status: NetworkStatus) => void) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners() {
    const status: NetworkStatus = { 
      online: this.isOnline, 
      lastCheck: new Date() 
    };
    
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in network status listener:', error);
      }
    });
  }

  // Method to update the API URL
  public updateApiUrl(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  // Clean up when needed
  public destroy() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}

// Export a singleton instance
export const networkStatusService = new NetworkStatusService();