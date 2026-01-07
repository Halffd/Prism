// Network status detection for offline-first functionality

export interface NetworkStatus {
  online: boolean;
  lastCheck: Date;
}

class NetworkStatusService {
  private isOnline: boolean = true;
  private listeners: Array<(status: NetworkStatus) => void> = [];
  private timerId: NodeJS.Timeout | null = null;

  constructor() {
    // Initialize network detection
    this.setupNetworkDetection();
  }

  private setupNetworkDetection() {
    // Initial check
    this.isOnline = navigator.onLine;
    
    // Listen to online/offline events
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
    
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
      // Try to ping a reliable endpoint
      const response = await fetch('/api/status', { 
        method: 'GET',
        cache: 'no-cache',
        timeout: 5000 // 5 second timeout
      }).catch(() => {
        // If fetch is not available, try a simple image request
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ ok: true } as Response);
          img.onerror = () => resolve({ ok: false } as Response);
          img.src = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==?t=${Date.now()}`;
        });
      });
      
      return response.ok === true;
    } catch (error) {
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